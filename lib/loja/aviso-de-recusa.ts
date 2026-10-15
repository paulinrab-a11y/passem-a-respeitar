import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { limita } from '@/lib/rate-limit';
import { enviaDepois } from '@/lib/sentry/depois';

/**
 * Aviso ao Sentry quando o webhook do Mercado Pago recusa uma notificacao
 * (#273).
 *
 * Antes era so `console.warn`: um segredo trocado no painel e esquecido na
 * Vercel recusaria todo pagamento de verdade, e ninguem ficaria sabendo ate
 * um cliente reclamar. Agora o dono recebe um aviso.
 *
 * Vai so o que ajuda a diagnosticar, em tag: o motivo da recusa e o que deu
 * errado na assinatura. Nada de corpo, id de recurso, cabecalho ou segredo:
 * quem forja nao ganha nada vendo o proprio evento, e o dono nao precisa de
 * mais que isso para saber se e configuracao ou robo.
 *
 * Orcamento contra rajada: a URL e publica, e um robo mandando lixo nao pode
 * virar um evento por request (gastaria a cota do Sentry e enterraria o
 * aviso que importa). Poucos por hora bastam para o dono perceber; o resto
 * fica so no log do servidor. Global, e nao por IP: o que se protege e a cota
 * do Sentry, e o robo troca de IP.
 */
export const ORCAMENTO_DE_AVISOS = { maximo: 5, janelaMs: 60 * 60 * 1000 };

/** Texto fixo: o Sentry agrupa por mensagem, e o motivo vai na tag. */
const MENSAGEM = 'webhook do mercado pago recusado';

type Recusa = {
  /** Por que o webhook recusou (o `motivo` de `processa`). */
  motivo: string;
  /** O que deu errado na assinatura (`sem-segredo`, `nao-confere`...). */
  assinatura: string;
};

export async function avisaRecusa({ motivo, assinatura }: Recusa): Promise<void> {
  const cota = await limita(
    'sentry:webhook-recusado',
    ORCAMENTO_DE_AVISOS.maximo,
    ORCAMENTO_DE_AVISOS.janelaMs
  );
  if (!cota.permitido) return;

  Sentry.captureMessage(MENSAGEM, { level: 'warning', tags: { motivo, assinatura } });
  // Depois da resposta (#281): o 401 sai sem esperar o envio.
  enviaDepois();
}
