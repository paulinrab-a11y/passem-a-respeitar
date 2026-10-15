import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { limita } from '@/lib/rate-limit';
import { enviaDepois } from '@/lib/sentry/depois';
import type { Veredito } from './assinatura-webhook';

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
 * fica so no log do servidor. Nao e por IP: o que se protege e a cota do
 * Sentry, e o robo troca de IP.
 *
 * Um orcamento por valor de `assinatura`, e nao um so para tudo: com uma cota
 * unica, um robo sem assinatura gastava a janela inteira e o `nao-confere` do
 * segredo trocado (o caso que motivou a #273) nunca virava evento. O valor e
 * um conjunto fechado (os sete motivos de recusa da assinatura e `valida`),
 * entao o teto total continua pequeno: oito vezes o maximo por hora, no pior
 * caso.
 */
export const ORCAMENTO_DE_AVISOS = { maximo: 5, janelaMs: 60 * 60 * 1000 };

/** Texto fixo: o Sentry agrupa por mensagem, e o motivo vai na tag. */
const MENSAGEM = 'webhook do mercado pago recusado';

type Recusa = {
  /** Por que o webhook recusou (o `motivo` de `processa`). */
  motivo: string;
  /**
   * O que deu errado na assinatura (`sem-segredo`, `nao-confere`...), ou
   * `valida`. Tipo fechado de proposito: vira chave do orcamento.
   */
  assinatura: Extract<Veredito, { valida: false }>['motivo'] | 'valida';
};

export async function avisaRecusa({ motivo, assinatura }: Recusa): Promise<void> {
  const cota = await limita(
    `sentry:webhook-recusado:${assinatura}`,
    ORCAMENTO_DE_AVISOS.maximo,
    ORCAMENTO_DE_AVISOS.janelaMs
  );
  if (!cota.permitido) return;

  Sentry.captureMessage(MENSAGEM, { level: 'warning', tags: { motivo, assinatura } });
  // Depois da resposta (#281): o 401 sai sem esperar o envio.
  enviaDepois();
}
