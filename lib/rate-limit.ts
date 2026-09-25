import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

/**
 * Rate limit (Issues #22 e #121).
 *
 * Duas implementacoes atras da mesma funcao, e a escolha e por variavel de
 * ambiente:
 *
 *   - Upstash Redis, quando `UPSTASH_REDIS_REST_URL` e `_TOKEN` existem. E o
 *     limite de verdade: compartilhado entre instancias, entao quem
 *     distribuir as tentativas entre funcoes serverless nao ganha nada.
 *   - Memoria, quando nao existem. Por instancia, e por isso mais fraco —
 *     mas funciona sem conta nenhuma (dev local, preview sem credencial) e e
 *     para onde se cai se o Redis falhar ou demorar. Falhar aberto nunca:
 *     sem Redis a rota nao fica sem limite, fica com o limite local.
 *
 * A assinatura e a mesma para as duas: nenhuma rota sabe qual esta em uso.
 */

export type Cota = {
  permitido: boolean;
  restantes: number;
  /** Segundos ate poder tentar de novo. Zero quando permitido. */
  esperarS: number;
};

// ---------------------------------------------------------------------------
// Memoria
// ---------------------------------------------------------------------------

type Janela = { contagem: number; expiraEm: number };

const janelas = new Map<string, Janela>();

/** Evita que o Map cresca sem fim numa instancia de vida longa. */
function limpaExpiradas(agora: number) {
  if (janelas.size < 5000) return;
  for (const [k, v] of janelas) {
    if (v.expiraEm <= agora) janelas.delete(k);
  }
}

function limitaNaMemoria(chave: string, maximo: number, janelaMs: number): Cota {
  const agora = Date.now();
  limpaExpiradas(agora);

  const atual = janelas.get(chave);

  if (!atual || atual.expiraEm <= agora) {
    janelas.set(chave, { contagem: 1, expiraEm: agora + janelaMs });
    return { permitido: true, restantes: maximo - 1, esperarS: 0 };
  }

  atual.contagem += 1;

  if (atual.contagem > maximo) {
    return {
      permitido: false,
      restantes: 0,
      esperarS: Math.max(1, Math.ceil((atual.expiraEm - agora) / 1000)),
    };
  }

  return { permitido: true, restantes: maximo - atual.contagem, esperarS: 0 };
}

// ---------------------------------------------------------------------------
// Upstash
// ---------------------------------------------------------------------------

/**
 * Um limitador por par (maximo, janela): o SDK fixa os dois na construcao.
 * O prefixo carrega o par para chaves iguais com limites diferentes nao
 * dividirem o mesmo contador no Redis.
 */
const limitadores = new Map<string, Ratelimit>();

/**
 * Quem ja esta bloqueado nem vai ao Redis: o SDK guarda o "ate quando" aqui
 * e responde na hora. E o que segura uma rajada de custar uma chamada por
 * request.
 */
const cacheEfemero = new Map<string, number>();

let conexao: { chave: string; redis: Redis } | null = null;

/** Lido a cada chamada, nao no topo do modulo: o teste troca o ambiente. */
function redisConfigurado(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const chave = `${url}|${token}`;
  if (conexao?.chave !== chave) {
    conexao = { chave, redis: new Redis({ url, token }) };
    limitadores.clear();
  }
  return conexao.redis;
}

function limitador(redis: Redis, maximo: number, janelaMs: number): Ratelimit {
  const id = `${maximo}:${janelaMs}`;
  let l = limitadores.get(id);
  if (!l) {
    l = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(maximo, `${janelaMs} ms`),
      prefix: `par:${id}`,
      ephemeralCache: cacheEfemero,
      // Redis lento nao pode segurar o login. Um segundo, e o SDK devolve
      // `reason: 'timeout'` — tratado abaixo como "cai na memoria", nunca
      // como "deixa passar".
      timeout: 1000,
    });
    limitadores.set(id, l);
  }
  return l;
}

let avisouFalha = false;

/**
 * Consome uma tentativa de `chave` e diz se cabe.
 *
 * `maximo` tentativas por `janelaMs`. A chave inclui o que se limita e por
 * quem — `entrar:email:<e-mail>`, `convite:<ip>` — e nunca e so o id: dois
 * limites diferentes sobre a mesma pessoa nao podem dividir contador.
 */
export async function limita(chave: string, maximo: number, janelaMs: number): Promise<Cota> {
  const redis = redisConfigurado();
  if (!redis) return limitaNaMemoria(chave, maximo, janelaMs);

  try {
    const r = await limitador(redis, maximo, janelaMs).limit(chave);

    // Timeout: o SDK "deixa passar" por padrao. Aqui nao: a memoria decide.
    if (r.reason === 'timeout') return limitaNaMemoria(chave, maximo, janelaMs);

    return {
      permitido: r.success,
      restantes: Math.max(0, r.remaining),
      esperarS: r.success ? 0 : Math.max(1, Math.ceil((r.reset - Date.now()) / 1000)),
    };
  } catch {
    // Uma vez por instancia: o log nao vira o proprio ataque.
    if (!avisouFalha) {
      avisouFalha = true;
      console.warn('[rate-limit] Redis indisponivel; limitando por instancia ate voltar');
    }
    return limitaNaMemoria(chave, maximo, janelaMs);
  }
}

/**
 * IP do visitante. Na Vercel vem em x-forwarded-for, com o IP real primeiro.
 * Sem cabecalho, cai num balde unico: prefiro limitar demais a nao limitar.
 */
export function ipDoRequest(headers: Headers) {
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return headers.get('x-real-ip')?.trim() || 'desconhecido';
}
