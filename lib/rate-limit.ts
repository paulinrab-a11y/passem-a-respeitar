/**
 * Rate limit em memoria.
 *
 * PROVISORIO. A Issue #22 troca isto por Upstash Redis, que e compartilhado
 * entre instancias. Como cada instancia serverless tem a propria memoria, este
 * aqui limita por instancia, nao globalmente: quem distribuir as tentativas
 * entre instancias consegue mais do que o limite nominal.
 *
 * Ainda assim vale mais do que nada — segura forca bruta ingenua, que e o que
 * bate numa rota de codigo de convite — e nao exige credencial nenhuma para
 * funcionar agora.
 */

type Janela = { contagem: number; expiraEm: number };

const janelas = new Map<string, Janela>();

/** Evita que o Map cresca sem fim numa instancia de vida longa. */
function limpaExpiradas(agora: number) {
  if (janelas.size < 5000) return;
  for (const [k, v] of janelas) {
    if (v.expiraEm <= agora) janelas.delete(k);
  }
}

export function limita(chave: string, maximo: number, janelaMs: number) {
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

/**
 * IP do visitante. Na Vercel vem em x-forwarded-for, com o IP real primeiro.
 * Sem cabecalho, cai num balde unico: prefiro limitar demais a nao limitar.
 */
export function ipDoRequest(headers: Headers) {
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return headers.get('x-real-ip')?.trim() || 'desconhecido';
}
