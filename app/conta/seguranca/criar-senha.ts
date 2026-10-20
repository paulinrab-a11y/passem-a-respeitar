'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import {
  cabeConferencia,
  cabeReenvioDoEmail,
  cabeReenvioDoIp,
  codigoDaContaConfere,
  gravaSenhaCriada,
  mandaCodigoDaConta,
} from '@/lib/conta/codigo';
import { seguraAtePiso } from '@/lib/conta/piso';
import { contaSemSenha } from '@/lib/conta/sem-senha';
import { senhaVazada } from '@/lib/conta/senha-servidor';
import { CODIGO_DIGITOS, esquemaCriarSenha } from '@/lib/esquemas';
import { ipDoRequest, limita } from '@/lib/rate-limit';
import { CAMPO_DA_ISCA, iscaPreenchida, RECUSA } from '@/lib/robo';
import { clienteDeAuth, lembrarDaSessao, usuarioDaSessao } from '@/lib/supabase/servidor';
import type { EstadoCriarSenha, EstadoEnvioDaSenha } from './estado-criar-senha';

/**
 * "Criar senha" em Seguranca, para a conta que nasceu pelo codigo do e-mail
 * (#389) e nao tem senha que a pessoa conheca.
 *
 * O codigo do e-mail faz o papel da senha atual: e a reautenticacao, feita no
 * mesmo envio que grava a senha. Sem ele, uma sessao esquecida aberta num
 * computador alheio bastaria para alguem por uma senha na conta e voltar
 * depois por ela.
 *
 * Quem decide se a conta tem senha e o servidor, pela marca em
 * `app_metadata` (lib/conta/sem-senha.ts), lida do Supabase a cada acao. A
 * tela so esconde o formulario; as duas acoes conferem de novo. Conta com
 * senha recebe "use Trocar senha", que pede a atual.
 *
 * Sem desafio da Cloudflare: como no aviso de /conta, a sessao ja diz quem
 * pede, o e-mail e o da conta, e a CSP de /conta nem abre o iframe do
 * Turnstile. O que limita e a cota por IP e por caixa no envio (as mesmas
 * chaves do codigo do cadastro e da entrada), e por IP e por conta na
 * conferencia.
 */

const SESSAO_EXPIROU = 'Sua sessão expirou. Entre de novo.';
const JA_TEM_SENHA = 'Sua conta já tem senha. Para mudar, use “Trocar senha”.';
const MUITOS_PEDIDOS = 'Muitos pedidos de código. Tente de novo mais tarde.';
/** A frase da #260, sem o "abaixo": aqui o botao de pedir outro fica ao lado. */
const CODIGO_ERRADO = `Código inválido ou vencido. Confira os ${CODIGO_DIGITOS} dígitos ou peça um novo.`;
const MUITAS_TENTATIVAS = 'Muitas tentativas. Espere alguns minutos e peça um código novo.';

/** O mesmo limite e a mesma chave da troca de senha: as duas portas somam. */
const LIMITE = { maximo: 5, janelaMs: 60 * 60 * 1000 };

export async function pedirCodigoDaSenha(
  anterior: EstadoEnvioDaSenha,
  _form: FormData
): Promise<EstadoEnvioDaSenha> {
  const tentativa = anterior.tentativa + 1;
  const falha = (texto: string) => ({
    recado: { tom: 'erro' as const, texto },
    enviadoEm: anterior.enviadoEm,
    tentativa,
  });

  // O e-mail vem da SESSAO, nunca do formulario: aceitar um de fora faria
  // desta acao um mandador de codigo para qualquer endereco.
  const usuario = await usuarioDaSessao();
  if (!usuario?.email) return falha(SESSAO_EXPIROU);

  if (!contaSemSenha(usuario)) {
    revalidatePath('/conta/seguranca');
    return falha(JA_TEM_SENHA);
  }

  const ip = ipDoRequest(await headers());
  // Os dois contadores andam sempre, como em `cabeReenvio`.
  const porIp = await cabeReenvioDoIp(ip);
  const porCaixa = await cabeReenvioDoEmail(usuario.email);
  if (!porIp || !porCaixa) return falha(MUITOS_PEDIDOS);

  const inicio = Date.now();
  const enviou = await mandaCodigoDaConta(usuario.email);
  await seguraAtePiso(inicio);

  // O erro que sobra, na pratica, e o intervalo minimo do Supabase entre
  // e-mails. Aqui pode ser dito: quem pede e a dona da conta.
  if (!enviou)
    return falha('Não consegui enviar o código agora. Espere um minuto e tente de novo.');

  return {
    recado: {
      tom: 'ok',
      texto: 'Enviamos um código de 8 dígitos para o seu e-mail. Confira também o spam.',
    },
    enviadoEm: Date.now(),
    tentativa,
  };
}

export async function criarSenha(
  anterior: EstadoCriarSenha,
  form: FormData
): Promise<EstadoCriarSenha> {
  const tentativa = anterior.tentativa + 1;
  const falha = (texto: string, campo: EstadoCriarSenha['campo'] = null): EstadoCriarSenha => ({
    recado: { tom: 'erro', texto },
    campo,
    tentativa,
  });

  if (iscaPreenchida(form.get(CAMPO_DA_ISCA))) return falha(RECUSA);

  const usuario = await usuarioDaSessao();
  if (!usuario?.email) return falha(SESSAO_EXPIROU);

  if (!contaSemSenha(usuario)) {
    revalidatePath('/conta/seguranca');
    return falha(JA_TEM_SENHA);
  }

  const cota = await limita(`senha:${usuario.id}`, LIMITE.maximo, LIMITE.janelaMs);
  if (!cota.permitido) return falha('Muitas tentativas. Tente de novo mais tarde.');

  const dados = esquemaCriarSenha.safeParse({
    codigo: String(form.get('codigo') ?? '').replace(/\D/g, ''),
    nova: form.get('nova'),
    confirmacao: form.get('confirmacao'),
  });
  if (!dados.success) {
    // Quem chegou aqui ja provou quem e pela sessao: dizer o campo nao vaza
    // nada, e generico so faria a pessoa adivinhar o que errou.
    const campo = dados.error.issues[0]?.path[0];
    if (campo === 'codigo')
      return falha(`Digite os ${CODIGO_DIGITOS} dígitos do código.`, 'codigo');
    if (campo === 'confirmacao') {
      return falha('A confirmação não bate com a nova senha.', 'confirmacao');
    }
    if (campo === 'nova') return falha('A nova senha precisa de pelo menos 8 caracteres.', 'nova');
    return falha('Preencha os três campos.');
  }
  const { codigo, nova } = dados.data;

  // Antes do codigo: senha vazada recusada nao gasta o codigo, e a pessoa
  // escolhe outra sem pedir e-mail novo.
  if (await senhaVazada(nova)) {
    return falha(
      'Essa senha aparece em vazamentos conhecidos. Escolha outra — não precisa ser complicada, precisa ser sua.',
      'nova'
    );
  }

  // Por conta, e nao por e-mail: e a conta da sessao que esta sendo chutada.
  // Mesma chave do aviso de /conta.
  const ip = ipDoRequest(await headers());
  if (!(await cabeConferencia(`conta:${usuario.id}`, ip))) return falha(MUITAS_TENTATIVAS);

  // Num client sem cookie, como no aviso de /conta: a sessao de quem pediu
  // fica onde esta ate a senha estar gravada.
  if (!(await codigoDaContaConfere(usuario.email, codigo))) {
    return falha(CODIGO_ERRADO, 'codigo');
  }

  const { error } = await gravaSenhaCriada(usuario.id, nova);
  // O codigo ja foi gasto: o caminho e pedir outro.
  if (error) return falha('Não consegui criar a senha agora. Peça um código novo e tente de novo.');

  revalidatePath('/conta/seguranca');

  // A troca pela chave secreta derrubou todas as sessoes, esta inclusive. A
  // nova nasce com a senha que a pessoa acabou de criar, e com a escolha de
  // "manter conectado" que ela fez quando entrou (#244).
  const supabase = await clienteDeAuth(await lembrarDaSessao());
  const entrada = await supabase.auth.signInWithPassword({ email: usuario.email, password: nova });
  if (entrada.error) {
    return {
      recado: { tom: 'ok', texto: 'Senha criada. Entre de novo com o seu e-mail e a senha nova.' },
      campo: null,
      tentativa,
      criada: true,
    };
  }

  // `others`: a segunda trava, como na entrada por codigo. A troca ja
  // derrubou as outras; se um dia deixar de derrubar, esta derruba.
  await supabase.auth.signOut({ scope: 'others' });

  return {
    recado: {
      tom: 'ok',
      texto: 'Senha criada. As sessões abertas em outros aparelhos foram encerradas.',
    },
    campo: null,
    tentativa,
    criada: true,
  };
}
