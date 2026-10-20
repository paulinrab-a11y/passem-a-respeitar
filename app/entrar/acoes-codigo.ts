'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { EstadoCodigo, EstadoReenvio } from '@/app/_ui/estado-do-codigo';
import {
  CODIGO_INCOMPLETO,
  CODIGO_INVALIDO,
  cabeConferencia,
  cabeReenvioDoEmail,
  cabeReenvioDoIp,
  entraPorCodigo,
  mandaCodigoDeEntrada,
} from '@/lib/conta/codigo';
import { seguraAtePiso } from '@/lib/conta/piso';
import { esquemaCodigo, esquemaPedirCodigo } from '@/lib/esquemas';
import { ipDoRequest } from '@/lib/rate-limit';
import {
  CAMPO_DA_ISCA,
  CAMPO_DO_DESAFIO,
  desafioConfere,
  iscaPreenchida,
  pareceRobo,
  RECUSA,
} from '@/lib/robo';
import { destinoSeguro } from '@/lib/rotas';
import { COOKIE_LEMBRAR, COOKIE_RECUPERACAO, opcoesDoLembrar } from '@/lib/supabase/cookies';
import { clienteDeAuth } from '@/lib/supabase/servidor';
import type { EstadoPedirCodigo } from './estado';

/**
 * Entrar sem senha, com um codigo de oito digitos no e-mail (#387).
 *
 * E o caminho principal de quem chega ao login vindo do checkout: a pessoa
 * digita o e-mail, recebe o codigo e volta para a compra, sem inventar senha.
 * O login e o cadastro com senha continuam como estao.
 *
 * O que estas acoes NUNCA dizem: se o e-mail tem conta. Pedir o codigo
 * responde igual para os dois casos, no texto e no tempo (o piso da #352), e
 * conferir responde "invalido ou vencido" para qualquer codigo errado. Do
 * lado do Supabase tambem nao ha diferenca: e-mail sem conta ganha uma, e
 * todo pedido manda um codigo.
 *
 * As cotas sao as do codigo do cadastro, nas mesmas chaves (lib/conta/
 * codigo.ts): pedir, reenviar e cadastrar somam no mesmo limite de e-mails
 * por caixa, e chutar codigo aqui ou na tela do cadastro soma no mesmo limite
 * de conferencias.
 */

const MUITOS_PEDIDOS = 'Muitos pedidos. Tente de novo mais tarde.';
const MUITAS_CONFERENCIAS = 'Muitas tentativas. Espere alguns minutos e peça um código novo.';
const SEM_ENTRADA = 'Não consegui terminar a entrada agora. Peça um código novo abaixo.';

const MENSAGENS: Record<'email' | 'aceite', string> = {
  email: 'Confira o e-mail.',
  aceite: 'Para continuar, é preciso aceitar a política de privacidade.',
};

/**
 * Pedir o codigo. Manda e-mail e pode criar conta, entao e a acao cara: isca,
 * desafio da Cloudflare e dois limites. O do IP vem antes do desafio, que e
 * uma chamada para fora; o do e-mail so depois dele, para um script trocando
 * de IP nao gastar a cota de uma caixa alheia sem passar pelo desafio (#285).
 */
export async function pedirCodigo(
  anterior: EstadoPedirCodigo,
  form: FormData
): Promise<EstadoPedirCodigo> {
  const tentativa = anterior.tentativa + 1;
  const falha = (erro: string, campo: EstadoPedirCodigo['campo'] = null) => ({
    erro,
    campo,
    tentativa,
  });

  const desafio = form.get(CAMPO_DO_DESAFIO);
  if (await pareceRobo({ isca: form.get(CAMPO_DA_ISCA), desafio })) return falha(RECUSA);

  const dados = esquemaPedirCodigo.safeParse({
    email: form.get('email'),
    // Caixa desmarcada nao aparece no FormData, e false nao passa no schema.
    aceite: form.get('aceite') === 'on',
    lembrar: form.get('lembrar') === 'on',
  });
  if (!dados.success) {
    const campo = dados.error.issues[0]?.path[0] === 'aceite' ? 'aceite' : 'email';
    return falha(MENSAGENS[campo], campo);
  }
  const { email, lembrar } = dados.data;

  const cabecalhos = await headers();
  const ip = ipDoRequest(cabecalhos);
  if (!(await cabeReenvioDoIp(ip))) return falha(MUITOS_PEDIDOS);

  if (!(await desafioConfere(desafio, 'entrar-codigo', ip))) return falha(RECUSA);

  if (!(await cabeReenvioDoEmail(email))) return falha(MUITOS_PEDIDOS);

  // Sem olhar o resultado, como no reenvio do cadastro: o erro que sobra e o
  // intervalo minimo do Supabase, e repassa-lo contaria a quem pede dois
  // seguidos que aquela caixa acabou de receber um codigo. O anterior
  // continua valendo quando ele recusa. O piso cobre "mandou" e "nao mandou".
  const inicio = Date.now();
  await mandaCodigoDeEntrada(email);
  await seguraAtePiso(inicio);

  return { erro: null, campo: null, tentativa, enviado: { email, lembrar } };
}

/**
 * Pedir outro codigo, da tela do codigo. As mesmas portas do pedido, com o
 * desafio do botao de reenviar. O aceite volta junto (a tela o guarda num
 * campo oculto): este pedido tambem pode criar a conta, e conta nenhuma nasce
 * sem ele.
 */
const REENVIADO = 'Se o e-mail for válido, enviamos outro código. Vale o mais recente.';

export async function reenviarCodigoDeEntrada(
  anterior: EstadoReenvio,
  form: FormData
): Promise<EstadoReenvio> {
  const falha = (erro: string) => ({
    erro,
    aviso: null,
    reenviadoEm: anterior.reenviadoEm,
    tentativa: anterior.tentativa + 1,
  });

  const desafio = form.get(CAMPO_DO_DESAFIO);
  if (await pareceRobo({ isca: form.get(CAMPO_DA_ISCA), desafio })) return falha(RECUSA);

  const dados = esquemaPedirCodigo.safeParse({
    email: form.get('email'),
    aceite: form.get('aceite') === 'on',
  });
  if (!dados.success) return falha('Confira o e-mail.');
  const { email } = dados.data;

  const ip = ipDoRequest(await headers());
  if (!(await cabeReenvioDoIp(ip))) return falha(MUITOS_PEDIDOS);

  if (!(await desafioConfere(desafio, 'reenviar-codigo', ip))) return falha(RECUSA);

  if (!(await cabeReenvioDoEmail(email))) return falha(MUITOS_PEDIDOS);

  const inicio = Date.now();
  await mandaCodigoDeEntrada(email);
  await seguraAtePiso(inicio);

  return {
    erro: null,
    aviso: REENVIADO,
    reenviadoEm: Date.now(),
    tentativa: anterior.tentativa + 1,
  };
}

/**
 * Conferir o codigo e entrar. Isca e dois limites (por IP e pelo e-mail
 * chutado), sem desafio, como as outras telas do codigo: ele ja e um segredo
 * que chegou por e-mail, e o Supabase ainda limita por baixo.
 *
 * A sessao nasce num client sem cookie e so chega ao navegador depois de
 * `entraPorCodigo` tirar da conta a senha de quem nao provou o e-mail. O
 * cookie e o mesmo do login: "manter conectado" registrado para o
 * middleware, e marca de recuperacao velha apagada (#348).
 */
export async function entrarComCodigo(
  anterior: EstadoCodigo,
  form: FormData
): Promise<EstadoCodigo> {
  const tentativa = anterior.tentativa + 1;
  const falha = (erro: string) => ({ erro, tentativa });

  if (iscaPreenchida(form.get(CAMPO_DA_ISCA))) return falha(RECUSA);

  const dados = esquemaCodigo.safeParse({
    email: form.get('email'),
    codigo: String(form.get('codigo') ?? '').replace(/\D/g, ''),
    lembrar: form.get('lembrar') === '1',
  });
  if (!dados.success) return falha(CODIGO_INCOMPLETO);
  const { email, codigo, lembrar } = dados.data;

  const ip = ipDoRequest(await headers());
  if (!(await cabeConferencia(`email:${email}`, ip))) return falha(MUITAS_CONFERENCIAS);

  // O piso cobre a conferencia inteira: codigo errado e codigo certo levam,
  // para quem mede, o mesmo tempo minimo.
  const inicio = Date.now();
  const entrada = await entraPorCodigo(email, codigo);
  await seguraAtePiso(inicio);

  if (entrada.resultado === 'invalido') return falha(CODIGO_INVALIDO);
  if (entrada.resultado === 'recuperar') return { erro: null, tentativa, desfecho: 'recuperar' };

  const supabase = await clienteDeAuth(lembrar);
  const { error } = await supabase.auth.setSession(entrada.sessao);
  // O codigo ja foi gasto: repetir daria "invalido ou vencido". Um novo
  // resolve, e a conta ja nao tem senha de mais ninguem.
  if (error) return falha(SEM_ENTRADA);

  const jar = await cookies();
  jar.set(COOKIE_LEMBRAR, lembrar ? '1' : '0', opcoesDoLembrar(lembrar));
  jar.delete(COOKIE_RECUPERACAO);

  // Fora de qualquer try: `redirect` funciona lancando uma excecao.
  redirect(destinoSeguro(form.get('next')?.toString()));
}
