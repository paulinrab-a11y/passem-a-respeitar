import { ambienteLocal, ehDestaMaquina } from './ambiente.mjs';

/**
 * Caixa de entrada da suite.
 *
 * O Supabase local nao manda e-mail para fora: entrega tudo a um servidor de
 * SMTP que so existe nesta maquina (Mailpit) e que guarda as mensagens. E de
 * la que o teste tira o link de confirmacao — o mesmo link que a pessoa
 * receberia, montado pelo mesmo codigo — e o texto do e-mail, que e o dos
 * modelos de supabase/templates (#183).
 */

type Resumo = { ID: string; Created: string; Subject: string };

export type Email = {
  id: string;
  assunto: string;
  html: string;
  /** O que a pessoa le: o HTML sem as marcas, com os espacos arrumados. */
  lido: string;
  /** O link de confirmacao, quando o e-mail tem um. */
  link: string | null;
};

type Filtro = {
  /** So e-mails recebidos depois deste instante, em milissegundos. */
  desde?: number;
  /** So e-mails cujo assunto contem este texto. */
  assunto?: string;
};

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

function le(html: string) {
  return html
    .replace(/<(style|script|title)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function linkDe(html: string) {
  const achado = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/.exec(html);
  if (!achado) return null;

  // Dentro de um atributo HTML o `&` vem escrito `&amp;`.
  const link = achado[0].replaceAll('&amp;', '&');

  if (!ehDestaMaquina(link)) {
    throw new Error(`o link do e-mail aponta para fora desta maquina: ${new URL(link).host}`);
  }
  return link;
}

async function busca(para: string, { desde = 0, assunto }: Filtro) {
  const { messages } = await json<{ messages: Resumo[] }>(
    `/api/v1/search?query=${encodeURIComponent(`to:"${para}"`)}`
  );

  return messages
    .filter((m) => new Date(m.Created).getTime() >= desde)
    .filter((m) => !assunto || m.Subject.includes(assunto))
    .sort((a, b) => new Date(b.Created).getTime() - new Date(a.Created).getTime());
}

/**
 * O e-mail mais recente para `para`.
 *
 * `desde` existe porque a conta pode ter recebido outro e-mail antes, e o que
 * interessa e o que saiu AGORA. `assunto` separa dois e-mails que chegam
 * juntos, como o aviso de senha trocada e o pedido que veio antes dele.
 */
export async function emailPara(para: string, filtro: Filtro = {}): Promise<Email> {
  const limite = Date.now() + ESPERA_MS;

  while (Date.now() < limite) {
    const [novo] = await busca(para, filtro);

    if (novo) {
      const { HTML, Text } = await json<{ HTML: string; Text: string }>(
        `/api/v1/message/${novo.ID}`
      );
      return {
        id: novo.ID,
        assunto: novo.Subject,
        html: HTML,
        lido: le(HTML),
        link: linkDe(`${HTML}\n${Text}`),
      };
    }

    await new Promise((r) => setTimeout(r, PASSO_MS));
  }

  const qual = filtro.assunto ? ` com assunto "${filtro.assunto}"` : '';
  throw new Error(`nenhum e-mail para ${para}${qual} em ${ESPERA_MS / 1000} s`);
}

/** Quantos e-mails `para` recebeu. Para provar que um e-mail NAO saiu. */
export async function quantosPara(para: string, filtro: Filtro = {}) {
  return (await busca(para, filtro)).length;
}

/** O link de confirmacao do e-mail mais recente para `para`. */
export async function linkDoEmail(para: string, desde = 0): Promise<string> {
  const { link } = await emailPara(para, { desde });
  if (!link) throw new Error(`o e-mail para ${para} chegou sem link de confirmacao`);
  return link;
}

/**
 * O codigo de seis digitos do e-mail mais recente para `para` (#224).
 *
 * Ancorado na frase do modelo, e nao em "seis digitos seguidos": o token do
 * link e hexadecimal e pode conter seis digitos por acaso — aconteceu na CI.
 */
export async function codigoDoEmail(para: string, desde = 0): Promise<string> {
  const { lido } = await emailPara(para, { desde });
  const achado = /digite este código no site: (\d{6})\b/.exec(lido);
  if (!achado) throw new Error(`nao achei o codigo de seis digitos no e-mail para ${para}`);
  return achado[1];
}
