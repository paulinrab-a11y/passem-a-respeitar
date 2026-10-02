import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { Redis } from '@upstash/redis';
import { z } from 'zod';
import { CONTATO } from '@/lib/contato';

/**
 * Frete pelo CEP, com o Melhor Envio (Issue #199).
 *
 * Ate a #199 o frete era zero, por decisao registrada na #99, e este arquivo
 * ja existia para a troca acontecer num lugar so. Continua assim: o checkout,
 * a criacao do pedido e a tela nao sabem que existe Melhor Envio. Sabem que ha
 * uma cotacao, com PAC e SEDEX.
 *
 * Tres regras, e as tres sao para o mesmo fim — nunca cobrar frete errado em
 * silencio:
 *
 *   1. Falha fechada. Configuracao faltando, produto sem medida, Melhor Envio
 *      fora do ar, CEP que nenhum servico atende: nao ha cotacao, e sem cotacao
 *      nao ha pedido. Frete zero por falha nao existe.
 *
 *   2. O preco e do servidor. A tela mostra o que a cotacao disse, e a criacao
 *      do pedido cota de novo. O que o navegador manda e a ESCOLHA do servico,
 *      nunca o valor.
 *
 *   3. A mesma pergunta tem a mesma resposta por meia hora. O preco que a
 *      pessoa viu na tela e o que entra no pedido, mesmo que o Melhor Envio
 *      mude o preco nesse meio tempo.
 *
 * O token so existe aqui, no servidor. Ele nao tem prefixo `NEXT_PUBLIC_`, e
 * este arquivo importa `server-only`: um import dele num componente do
 * navegador quebra o build.
 */

export type Servico = 'pac' | 'sedex';

/** Os ids sao os do Melhor Envio para os dois servicos dos Correios. */
const SERVICOS = {
  pac: { id: 1, nome: 'PAC' },
  sedex: { id: 2, nome: 'SEDEX' },
} as const satisfies Record<Servico, { id: number; nome: string }>;

export const esquemaServico = z.enum(['pac', 'sedex']);

/** Uma linha do carrinho, ja com o preco do catalogo e as medidas do produto. */
export type Volume = {
  slug: string;
  quantidade: number;
  precoUnitarioCentavos: number;
  /** Nulos enquanto o dono nao informa: sem medida, sem frete. */
  pesoGramas: number | null;
  alturaCm: number | null;
  larguraCm: number | null;
  comprimentoCm: number | null;
};

export type OpcaoDeFrete = {
  servico: Servico;
  nome: string;
  precoCentavos: number;
  /** Transporte, em dias uteis. Os 30 dias de producao (#197) vem antes. */
  prazoDias: number;
};

export type MotivoDoFrete =
  /** Falta token, CEP de origem, ou o ambiente nao bate com producao. */
  | 'frete-sem-configuracao'
  /** Algum produto do carrinho ainda nao tem peso e medidas. */
  | 'frete-sem-medida'
  /** O Melhor Envio recusou o CEP de destino. */
  | 'frete-cep-invalido'
  /** Nenhum dos dois servicos atende este CEP. */
  | 'frete-sem-servico'
  /** Rede, demora, resposta torta ou erro do lado deles. */
  | 'frete-fora-do-ar';

export type Cotacao = { ok: true; opcoes: OpcaoDeFrete[] } | { ok: false; motivo: MotivoDoFrete };

const ESPERA_MS = 8000;
const CACHE_S = 30 * 60;

const PRODUCAO = 'https://melhorenvio.com.br';
const SANDBOX = 'https://sandbox.melhorenvio.com.br';
const CAMINHO = '/api/v2/me/shipment/calculate';

type Configuracao = { token: string; origem: string; base: string };

/**
 * Lido a cada chamada, nao no topo do modulo: o teste troca o ambiente.
 *
 * Em producao o ambiente do Melhor Envio TEM que ser producao. Token de
 * sandbox ali seria preco inventado com cara de preco de verdade — o mesmo
 * raciocinio das chaves de teste da Cloudflare, na #28.
 *
 * `MELHOR_ENVIO_URL` existe para a suite de ponta a ponta apontar para um
 * Melhor Envio falso, nesta maquina. Em producao ela e ignorada.
 */
function configuracao(): Configuracao | null {
  const token = process.env.MELHOR_ENVIO_TOKEN;
  const origem = process.env.MELHOR_ENVIO_CEP_ORIGEM?.replace(/\D/g, '') ?? '';
  const producao = process.env.VERCEL_ENV === 'production';
  const ambiente = process.env.MELHOR_ENVIO_AMBIENTE === 'producao' ? 'producao' : 'sandbox';

  if (!token || !/^\d{8}$/.test(origem)) return null;
  if (producao && ambiente !== 'producao') return null;

  const desvio = producao ? undefined : process.env.MELHOR_ENVIO_URL;
  const base = desvio || (ambiente === 'producao' ? PRODUCAO : SANDBOX);
  return { token, origem, base };
}

async function avisa(motivo: string, nivel: 'warning' | 'error' = 'error') {
  // Vai so o motivo. Nada de CEP, token ou corpo de resposta.
  Sentry.captureMessage('frete: nao consegui cotar', { level: nivel, tags: { motivo } });
  await Sentry.flush(2000);
}

// ---------------------------------------------------------------------------
// A resposta do Melhor Envio
// ---------------------------------------------------------------------------

/** Preco vem como texto ("23.50") ou numero. */
const valor = z.union([z.string(), z.number()]);

const esquemaDaResposta = z.array(
  z.object({
    id: z.number(),
    price: valor.optional(),
    custom_price: valor.optional(),
    delivery_time: z.number().optional(),
    custom_delivery_time: z.number().optional(),
    // Servico que nao atende o CEP vem na lista, com `error` no lugar do preco.
    error: z.string().optional(),
  })
);

/**
 * "23.5" vira 2350, sem passar por ponto flutuante: 0.1 + 0.2 nao e 0.3, e
 * dinheiro nao pode depender disso. Fora do formato, `null`.
 */
export function paraCentavos(bruto: string | number): number | null {
  const texto = typeof bruto === 'number' ? bruto.toFixed(2) : bruto.trim();
  const m = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(texto);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

function opcoesDa(resposta: z.infer<typeof esquemaDaResposta>): OpcaoDeFrete[] {
  const opcoes: OpcaoDeFrete[] = [];

  for (const servico of ['pac', 'sedex'] as const) {
    const linha = resposta.find((r) => r.id === SERVICOS[servico].id);
    if (!linha || linha.error) continue;

    // `custom_*` e o que a conta do dono paga e leva de fato, com o desconto
    // que ela tiver. O resto e a tabela cheia.
    const bruto = linha.custom_price ?? linha.price;
    const precoCentavos = bruto === undefined ? null : paraCentavos(bruto);
    const prazoDias = linha.custom_delivery_time ?? linha.delivery_time;

    if (precoCentavos === null || precoCentavos <= 0) continue;
    if (!prazoDias || !Number.isInteger(prazoDias) || prazoDias < 1 || prazoDias > 120) continue;

    opcoes.push({ servico, nome: SERVICOS[servico].nome, precoCentavos, prazoDias });
  }

  return opcoes;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * No Upstash quando ele existe, para valer entre instancias: a tela e a
 * criacao do pedido podem cair em funcoes diferentes. Na memoria quando nao.
 * Cache que falha nunca impede a cotacao, so a deixa sem cache.
 */
const memoria = new Map<string, { expiraEm: number; opcoes: OpcaoDeFrete[] }>();

function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? new Redis({ url, token }) : null;
}

async function chaveDe(corpo: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(corpo));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
  return `par:frete:${hex}`;
}

async function leCache(chave: string): Promise<OpcaoDeFrete[] | null> {
  const r = redis();
  if (r) {
    try {
      return (await r.get<OpcaoDeFrete[]>(chave)) ?? null;
    } catch {
      return null;
    }
  }
  const linha = memoria.get(chave);
  if (!linha || linha.expiraEm <= Date.now()) return null;
  return linha.opcoes;
}

async function gravaCache(chave: string, opcoes: OpcaoDeFrete[]) {
  const r = redis();
  if (r) {
    try {
      await r.set(chave, opcoes, { ex: CACHE_S });
    } catch {
      // Sem cache desta vez. A cotacao em si ja deu certo.
    }
    return;
  }
  if (memoria.size > 2000) memoria.clear();
  memoria.set(chave, { expiraEm: Date.now() + CACHE_S * 1000, opcoes });
}

// ---------------------------------------------------------------------------
// A cotacao
// ---------------------------------------------------------------------------

/**
 * PAC e SEDEX para este carrinho, ate este CEP.
 *
 * `cep` chega so com digitos: quem chama ja passou pelo schema do endereco.
 */
export async function cotaFrete({
  cep,
  volumes,
}: {
  cep: string;
  volumes: Volume[];
}): Promise<Cotacao> {
  if (!/^\d{8}$/.test(cep)) return { ok: false, motivo: 'frete-cep-invalido' };

  const config = configuracao();
  if (!config) {
    if (process.env.VERCEL_ENV === 'production') await avisa('sem-configuracao');
    return { ok: false, motivo: 'frete-sem-configuracao' };
  }

  const semMedida = volumes.some(
    (v) => !v.pesoGramas || !v.alturaCm || !v.larguraCm || !v.comprimentoCm
  );
  if (volumes.length === 0 || semMedida) {
    if (process.env.VERCEL_ENV === 'production') await avisa('sem-medida');
    return { ok: false, motivo: 'frete-sem-medida' };
  }

  const corpo = {
    from: { postal_code: config.origem },
    to: { postal_code: cep },
    products: volumes.map((v) => ({
      id: v.slug,
      width: v.larguraCm,
      height: v.alturaCm,
      length: v.comprimentoCm,
      weight: (v.pesoGramas as number) / 1000,
      // Valor declarado: e o que o seguro dos Correios cobre se o pacote
      // sumir. Abaixo do preco, a perda seria do dono.
      insurance_value: v.precoUnitarioCentavos / 100,
      quantity: v.quantidade,
    })),
    options: { receipt: false, own_hand: false },
    services: `${SERVICOS.pac.id},${SERVICOS.sedex.id}`,
  };

  // A chave inclui a origem e a URL: trocar de ambiente nao pode devolver
  // preco do ambiente anterior.
  const chave = await chaveDe({ base: config.base, corpo });
  const guardado = await leCache(chave);
  if (guardado) return { ok: true, opcoes: guardado };

  let resposta: Response;
  try {
    resposta = await fetch(`${config.base}${CAMINHO}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
        // O Melhor Envio pede nome da aplicacao e um e-mail de contato.
        'User-Agent': `Passem a Respeitar (${CONTATO})`,
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(ESPERA_MS),
      cache: 'no-store',
    });
  } catch {
    await avisa('fora-do-ar');
    return { ok: false, motivo: 'frete-fora-do-ar' };
  }

  // Token vencido, revogado ou sem a permissao: e configuracao nossa. O
  // token do painel vale um ano, e este e o aviso de que ele venceu.
  if (resposta.status === 401 || resposta.status === 403) {
    await avisa(`http-${resposta.status}`);
    return { ok: false, motivo: 'frete-sem-configuracao' };
  }

  // Validacao: o mais comum e CEP que nao existe.
  if (resposta.status === 422) return { ok: false, motivo: 'frete-cep-invalido' };

  if (!resposta.ok) {
    await avisa(`http-${resposta.status}`);
    return { ok: false, motivo: 'frete-fora-do-ar' };
  }

  let lido: z.infer<typeof esquemaDaResposta>;
  try {
    const json: unknown = await resposta.json();
    const parse = esquemaDaResposta.safeParse(json);
    if (!parse.success) throw new Error('resposta fora do formato');
    lido = parse.data;
  } catch {
    await avisa('resposta-torta');
    return { ok: false, motivo: 'frete-fora-do-ar' };
  }

  const opcoes = opcoesDa(lido);
  if (opcoes.length === 0) return { ok: false, motivo: 'frete-sem-servico' };

  await gravaCache(chave, opcoes);
  return { ok: true, opcoes };
}
