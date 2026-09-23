import 'server-only';

/**
 * Checagem contra senha vazada, no Have I Been Pwned (Issue #25).
 *
 * O truque que torna isso aceitavel chama-se k-anonymity: a senha vira um
 * SHA-1, e **so os 5 primeiros caracteres do hash** saem daqui. O serviço
 * devolve todos os hashes que comecam com aqueles 5 — algumas centenas — e a
 * comparacao acontece do nosso lado. Eles nunca veem a senha, nem o hash
 * completo, nem sabem qual dos milhares de resultados era o nosso.
 *
 * A chamada sai do servidor, e nao do navegador: a CSP tem `connect-src
 * 'self'` e nao vou abrir um host nela por causa disto.
 */

const LIMITE_MS = 2500;

export async function senhaVazada(senha: string): Promise<boolean> {
  const hash = await sha1Hex(senha);
  const prefixo = hash.slice(0, 5);
  const sufixo = hash.slice(5);

  try {
    const resposta = await fetch(`https://api.pwnedpasswords.com/range/${prefixo}`, {
      // Add-Padding enche a resposta com registros falsos, para o TAMANHO dela
      // nao entregar quantos vazamentos aquele prefixo tem.
      headers: { 'Add-Padding': 'true', 'User-Agent': 'passem-a-respeitar' },
      signal: AbortSignal.timeout(LIMITE_MS),
      cache: 'no-store',
    });

    if (!resposta.ok) return false;

    for (const linha of (await resposta.text()).split('\n')) {
      const [sufixoDeles, contagem] = linha.trim().split(':');
      // O padding vem com contagem 0. Sem esta checagem, todo mundo seria
      // marcado como vazado de vez em quando.
      if (sufixoDeles === sufixo && Number(contagem) > 0) return true;
    }

    return false;
  } catch {
    // Falha aberta, de proposito. O HIBP fora do ar nao pode impedir alguem de
    // trocar a propria senha — seria transformar a indisponibilidade de um
    // servico de terceiro em indisponibilidade da nossa conta. O minimo de 8
    // caracteres continua valendo, e ele nao depende de ninguem.
    return false;
  }
}

async function sha1Hex(valor: string) {
  const bytes = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(valor));
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}
