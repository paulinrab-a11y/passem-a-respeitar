import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { enviaDepois } from '@/lib/sentry/depois';

/**
 * Quem vende (Issue #276).
 *
 * O Decreto 7.962/2013, art. 2º, manda a loja online mostrar nome ou razao
 * social, CPF ou CNPJ, endereco fisico e contato. Os tres primeiros moram em
 * variaveis do servidor, cadastradas pelo dono na Vercel, e nao no codigo:
 * dado de pessoa nao vai para o repositorio, e o agente que escreve o codigo
 * nao recebe nem inventa esses dados. O contato e o CONTATO de lib/contato.ts.
 *
 * Sem `NEXT_PUBLIC_`: a pagina /termos le no servidor e entrega o texto
 * pronto. Nada disto precisa existir no bundle.
 */
export type DadosDoVendedor = {
  nome: string;
  /** Como o dono cadastrou: com ou sem pontuacao. */
  documento: string;
  /** "CPF", "CNPJ", ou "CPF ou CNPJ" quando a contagem de digitos nao diz. */
  tipoDoDocumento: 'CPF' | 'CNPJ' | 'CPF ou CNPJ';
  endereco: string;
};

function le(nome: string): string {
  return process.env[nome]?.trim() ?? '';
}

/**
 * Os tres juntos, ou nulo. Lido a cada chamada, e nao no topo do modulo: o
 * teste troca o ambiente, e a pagina e dinamica.
 *
 * Basta um faltar para voltar nulo: nome sem documento, ou documento sem
 * endereco, nao e a identificacao que o decreto pede, e meia identificacao
 * com cara de inteira e pior que o aviso de "em atualizacao".
 */
export function dadosDoVendedor(): DadosDoVendedor | null {
  const nome = le('VENDEDOR_NOME');
  const documento = le('VENDEDOR_DOCUMENTO');
  const endereco = le('VENDEDOR_ENDERECO');
  if (!nome || !documento || !endereco) return null;

  // Onze digitos e CPF, catorze e CNPJ. Qualquer outra conta e documento que
  // o dono escreveu de outro jeito: sai como esta, sem rotulo inventado.
  const digitos = documento.replace(/\D/g, '').length;
  const tipoDoDocumento = digitos === 11 ? 'CPF' : digitos === 14 ? 'CNPJ' : 'CPF ou CNPJ';

  return { nome, documento, tipoDoDocumento, endereco };
}

/**
 * Pode cobrar? Em producao, so com quem vende identificado.
 *
 * Sem isto, um go-live com as variaveis esquecidas venderia sem a
 * identificacao que a lei pede, e ninguem perceberia ate alguem reclamar.
 * Falha fechada, como o webhook sem segredo: a tela de pagamento mostra o
 * mesmo "fora do ar" de quando falta a chave do Mercado Pago, a rota de
 * cobranca recusa, e o dono recebe o aviso no Sentry.
 *
 * Preview e desenvolvimento seguem cobrando sem os dados: la o Mercado Pago e
 * o de teste, e travar ali so atrapalharia quem testa.
 */
export function vendaLiberada(): boolean {
  if (process.env.VERCEL_ENV !== 'production') return true;
  if (dadosDoVendedor()) return true;

  // So o fato. O que falta o dono ve na Vercel; nada de dado no aviso.
  Sentry.captureMessage('venda bloqueada: faltam os dados de quem vende', { level: 'error' });
  enviaDepois();
  return false;
}
