import { ambienteLocal, ehDestaMaquina } from './ambiente.mjs';

/**
 * Caixa de entrada da suite.
 *
 * O Supabase local nao manda e-mail para fora: entrega tudo a um servidor de
 * SMTP que so existe nesta maquina (Mailpit) e que guarda as mensagens. E de
 * la que o teste tira o link de confirmacao — o mesmo link que a pessoa
 * receberia, montado pelo mesmo codigo.
 */

type Resumo = { ID: string; Created: string };

const ESPERA_MS = 15_000;
const PASSO_MS = 300;

async function json<T>(caminho: string): Promise<T> {
  const r = await fetch(new URL(caminho, ambienteLocal().correio));
  if (!r.ok) throw new Error(`correio local respondeu ${r.status} em ${caminho}`);
  return (await r.json()) as T;
}

/** Esvazia a caixa. Mensagem de rodada anterior nao pode responder por esta. */
export async function esvaziaCorreio() {
  const r = await fetch(new URL('/api/v1/messages', ambienteLocal().correio), {
    method: 'DELETE',
  });
  if (!r.ok) throw new Error(`nao esvaziei o correio local: ${r.status}`);
}

/**
 * O link do e-mail mais recente para `para`, recebido depois de `desde`.
 *
 * `desde` existe por causa da recuperacao de senha: a conta pode ter recebido
 * outro e-mail antes, e o link que interessa e o que saiu AGORA.
 */
export async function linkDoEmail(para: string, desde = 0): Promise<string> {
  const limite = Date.now() + ESPERA_MS;

  while (Date.now() < limite) {
    const busca = await json<{ messages: Resumo[] }>(
      `/api/v1/search?query=${encodeURIComponent(`to:"${para}"`)}`
    );

    const nova = busca.messages
      .filter((m) => new Date(m.Created).getTime() >= desde)
      .sort((a, b) => new Date(b.Created).getTime() - new Date(a.Created).getTime())[0];

    if (nova) {
      const { HTML, Text } = await json<{ HTML: string; Text: string }>(
        `/api/v1/message/${nova.ID}`
      );
      const achado = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/.exec(`${HTML}\n${Text}`);
      if (!achado) throw new Error(`o e-mail para ${para} chegou sem link de confirmacao`);

      // Dentro de um atributo HTML o `&` vem escrito `&amp;`.
      const link = achado[0].replaceAll('&amp;', '&');

      if (!ehDestaMaquina(link)) {
        throw new Error(`o link do e-mail aponta para fora desta maquina: ${new URL(link).host}`);
      }
      return link;
    }

    await new Promise((r) => setTimeout(r, PASSO_MS));
  }

  throw new Error(`nenhum e-mail para ${para} em ${ESPERA_MS / 1000} s`);
}
