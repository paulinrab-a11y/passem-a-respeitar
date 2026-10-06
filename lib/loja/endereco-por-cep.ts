import 'server-only';

import { z } from 'zod';
import { ehUf } from './endereco';

/**
 * Rua, bairro, cidade e UF a partir do CEP (Issue #204), pelo ViaCEP.
 *
 * O ViaCEP e um servico publico e gratuito, sem chave. A consulta sai DAQUI,
 * do servidor, e nao do navegador: a CSP do site continua sem host novo, e a
 * pessoa nao fala com um terceiro sem saber.
 *
 * O que volta e sugestao para a pessoa conferir, nao verdade: o endereco que
 * vale e o que ela envia, validado pelo `esquemaEndereco` como sempre. Por
 * isso nenhuma falha aqui e erro para ela — sem resposta, ela digita.
 */

export type EnderecoPeloCep = {
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
};

export type BuscaPeloCep =
  | { ok: true; endereco: EnderecoPeloCep }
  /** O ViaCEP nao conhece o CEP. A pessoa preenche. */
  | { ok: false; motivo: 'cep-desconhecido' }
  | { ok: false; motivo: 'cep-invalido' }
  /** Rede, demora ou resposta torta. A pessoa preenche. */
  | { ok: false; motivo: 'fora-do-ar' };

const VIACEP = 'https://viacep.com.br';
const ESPERA_MS = 4000;

/**
 * O que o ViaCEP devolve. `erro` vem como texto "true" em CEP que nao existe.
 * CEP "geral" de cidade pequena vem com logradouro e bairro vazios, e isso
 * nao e erro: a pessoa completa.
 */
const esquemaDaResposta = z.object({
  erro: z.union([z.string(), z.boolean()]).optional(),
  logradouro: z.string().optional(),
  bairro: z.string().optional(),
  localidade: z.string().optional(),
  uf: z.string().optional(),
});

/**
 * Trocavel pela suite, que aponta para um ViaCEP falso nesta maquina. Em
 * producao a variavel e ignorada, como a do Melhor Envio.
 */
function base() {
  const desvio = process.env.VERCEL_ENV === 'production' ? undefined : process.env.VIACEP_URL;
  return desvio || VIACEP;
}

export async function buscaEnderecoPeloCep(cep: string): Promise<BuscaPeloCep> {
  if (!/^\d{8}$/.test(cep)) return { ok: false, motivo: 'cep-invalido' };

  let lido: z.infer<typeof esquemaDaResposta>;
  try {
    const r = await fetch(`${base()}/ws/${cep}/json/`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(ESPERA_MS),
      // CEP muda raramente. Um dia de cache poupa o ViaCEP e responde na hora
      // para o segundo visitante do mesmo bairro.
      next: { revalidate: 60 * 60 * 24 },
    });
    // 400 e CEP mal formado, que o teste acima ja barrou; qualquer outro
    // status fora do 200 e deles.
    if (!r.ok) return { ok: false, motivo: 'fora-do-ar' };
    const parse = esquemaDaResposta.safeParse(await r.json());
    if (!parse.success) return { ok: false, motivo: 'fora-do-ar' };
    lido = parse.data;
  } catch {
    return { ok: false, motivo: 'fora-do-ar' };
  }

  if (lido.erro === 'true' || lido.erro === true) return { ok: false, motivo: 'cep-desconhecido' };

  const uf = (lido.uf ?? '').trim().toUpperCase();
  // Sem UF nao ha endereco: e o unico campo que o ViaCEP sempre tem quando o
  // CEP existe. Resposta sem ele e resposta torta.
  if (!ehUf(uf)) return { ok: false, motivo: 'fora-do-ar' };

  return {
    ok: true,
    endereco: {
      logradouro: (lido.logradouro ?? '').trim().slice(0, 160),
      bairro: (lido.bairro ?? '').trim().slice(0, 80),
      cidade: (lido.localidade ?? '').trim().slice(0, 80),
      uf,
    },
  };
}
