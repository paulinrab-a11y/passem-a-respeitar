'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import {
  autenticadoRecentemente,
  RECADO_INDISPONIVEL,
  reautenticar,
  senhaConfere,
} from '@/lib/conta/reautenticacao';
import { senhaVazada } from '@/lib/conta/senha-servidor';
import { esquemaTrocarSenha } from '@/lib/esquemas';
import { ipDoRequest, limita } from '@/lib/rate-limit';
import {
  clienteDeAuth,
  clienteServidor,
  lembrarDaSessao,
  usuarioDaSessao,
} from '@/lib/supabase/servidor';
import type { EstadoSenha } from './estado';
import type { EstadoSessao } from './estado-sessoes';

/** Cinco tentativas por hora. O alvo aqui e quem sentou no computador alheio. */
const LIMITE = { maximo: 5, janelaMs: 60 * 60 * 1000 };

/**
 * A reautenticacao e outra porta para a mesma senha (#244): sem limite
 * proprio, quem tem a sessao aberta roda a lista de senhas por aqui e o
 * limite da troca de senha nao serve de nada. Por conta, o mesmo da troca.
 * Por IP, mais folgado: quem divide a rede nao pode ser barrado pelo vizinho,
 * mas uma origem so tambem nao testa senhas em varias contas sequestradas.
 */
const REAUTH_POR_CONTA = { maximo: 5, janelaMs: 60 * 60 * 1000 };
const REAUTH_POR_IP = { maximo: 20, janelaMs: 60 * 60 * 1000 };

const MUITAS_TENTATIVAS = 'Muitas tentativas. Tente de novo mais tarde.';

/** SHA-256 em hex: o formato opaco que a lista de aparelhos entrega. */
const ehIdentificador = (valor: string) => /^[0-9a-f]{64}$/.test(valor);

function erro(texto: string, tentativa: number, campo: EstadoSenha['campo'] = null): EstadoSenha {
  return { recado: { tom: 'erro', texto }, campo, tentativa };
}

export async function trocarSenha(anterior: EstadoSenha, form: FormData): Promise<EstadoSenha> {
  const tentativa = anterior.tentativa + 1;

  const usuario = await usuarioDaSessao();
  if (!usuario?.email) {
    return erro('Sua sessão expirou. Entre de novo.', tentativa);
  }

  const cota = await limita(`senha:${usuario.id}`, LIMITE.maximo, LIMITE.janelaMs);
  if (!cota.permitido) {
    return erro(MUITAS_TENTATIVAS, tentativa);
  }

  const dados = esquemaTrocarSenha.safeParse({
    atual: form.get('atual'),
    nova: form.get('nova'),
    confirmacao: form.get('confirmacao'),
  });

  if (!dados.success) {
    // Mensagens distintas aqui nao vazam nada: quem chegou ate esta tela ja
    // provou quem e. Generico so faria a pessoa adivinhar o que errou.
    const campo = dados.error.issues[0]?.path[0];
    if (campo === 'confirmacao') {
      return erro('A confirmação não bate com a nova senha.', tentativa, 'confirmacao');
    }
    if (campo === 'nova') {
      const nova = String(form.get('nova') ?? '');
      if (nova === String(form.get('atual') ?? '')) {
        return erro('A nova senha é igual à atual.', tentativa, 'nova');
      }
      return erro('A nova senha precisa de pelo menos 8 caracteres.', tentativa, 'nova');
    }
    return erro('Preencha os três campos.', tentativa);
  }

  const { atual, nova } = dados.data;

  const conferencia = await senhaConfere(usuario.email, atual);
  // Servico fora do ar nao e senha errada: apontar o campo "atual" aqui
  // mandaria a pessoa redigitar uma senha que estava certa.
  if (conferencia === 'indisponivel') {
    return erro(RECADO_INDISPONIVEL, tentativa);
  }
  if (conferencia === 'errada') {
    return erro('A senha atual está incorreta.', tentativa, 'atual');
  }

  if (await senhaVazada(nova)) {
    return erro(
      'Essa senha aparece em vazamentos conhecidos. Escolha outra — não precisa ser complicada, precisa ser sua.',
      tentativa,
      'nova'
    );
  }

  // `updateUser` regrava os cookies da sessao. Com a escolha real, e nao
  // `true`: trocar a senha num computador emprestado nao pode ser o que deixa
  // a sessao viva por trinta dias ali (#244).
  const supabase = await clienteDeAuth(await lembrarDaSessao());
  const { error } = await supabase.auth.updateUser({ password: nova });

  if (error) {
    return erro('Não consegui trocar a senha agora.', tentativa);
  }

  // `others`: derruba as outras sessoes e mantem esta. E o ponto da troca de
  // senha — quem tinha acesso perde, e quem trocou continua onde estava, sem
  // ser jogado para a tela de login logo depois de fazer a coisa certa.
  await supabase.auth.signOut({ scope: 'others' });

  return {
    recado: {
      tom: 'ok',
      texto: 'Senha trocada. As sessões abertas em outros aparelhos foram encerradas.',
    },
    campo: null,
    tentativa,
  };
}

/**
 * Encerra uma sessao pelo identificador opaco que a lista entregou.
 *
 * Nao ha o que validar do lado de ca: a funcao do banco so acha o hash entre
 * as sessoes DESTE usuario, e recusa a atual. Um identificador inventado
 * simplesmente nao casa com nada.
 */
export async function encerrarSessao(
  _anterior: EstadoSessao,
  form: FormData
): Promise<EstadoSessao> {
  const identificador = String(form.get('identificador') ?? '');

  if (!ehIdentificador(identificador)) {
    return { recado: { tom: 'erro', texto: 'Sessão inválida.' }, encerrado: null };
  }

  if (!(await usuarioDaSessao())) {
    return {
      recado: { tom: 'erro', texto: 'Sua sessão expirou. Entre de novo.' },
      encerrado: null,
    };
  }

  // Derrubar a sessao de outro aparelho e acao sensivel: e o primeiro botao
  // que quem sequestrou uma sessao aberta usaria para expulsar o dono da
  // propria conta. A janela e conferida antes de falar com o banco.
  if (!(await autenticadoRecentemente())) {
    return { recado: null, encerrado: null, precisaReautenticar: true };
  }

  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc('encerra_sessao', {
    p_identificador: identificador,
  });

  if (error) {
    return { recado: { tom: 'erro', texto: 'Não consegui encerrar agora.' }, encerrado: null };
  }

  if (!data) {
    // Ou nao e sua, ou e a atual, ou ja tinha caido. As tres respondem igual:
    // dizer qual delas e contaria algo a quem tentou adivinhar.
    return {
      recado: { tom: 'erro', texto: 'Essa sessão não está mais na lista.' },
      encerrado: null,
    };
  }

  revalidatePath('/conta/seguranca');
  return { recado: { tom: 'ok', texto: 'Sessão encerrada.' }, encerrado: identificador };
}

/**
 * Confirma a senha e refaz a acao que estava pendente (#40).
 *
 * Quem decide o que refazer e a tela, que guardou o identificador. Aqui so se
 * reautentica e se delega — assim esta acao serve para qualquer outra que
 * venha a precisar da janela.
 *
 * Toda recusa volta com `precisaReautenticar`: o modal fica aberto mostrando
 * o motivo. Fechar esconderia o "muitas tentativas" de quem so precisa esperar.
 */
export async function reautenticarEEncerrar(
  anterior: EstadoSessao,
  form: FormData
): Promise<EstadoSessao> {
  // Antes da senha e antes do limite: identificador com cara errada nao gasta
  // tentativa de ninguem, e nao ha por que conferir a senha para uma acao que
  // `encerrarSessao` recusaria de qualquer jeito.
  const identificador = String(form.get('identificador') ?? '');
  if (!ehIdentificador(identificador)) {
    return { recado: { tom: 'erro', texto: 'Sessão inválida.' }, encerrado: null };
  }

  const usuario = await usuarioDaSessao();
  if (!usuario) {
    return {
      recado: { tom: 'erro', texto: 'Sua sessão expirou. Entre de novo.' },
      encerrado: null,
    };
  }

  const ip = ipDoRequest(await headers());
  const cotaConta = await limita(
    `reauth:${usuario.id}`,
    REAUTH_POR_CONTA.maximo,
    REAUTH_POR_CONTA.janelaMs
  );
  const cotaIp = await limita(`reauth:ip:${ip}`, REAUTH_POR_IP.maximo, REAUTH_POR_IP.janelaMs);
  if (!cotaConta.permitido || !cotaIp.permitido) {
    return {
      recado: { tom: 'erro', texto: MUITAS_TENTATIVAS },
      encerrado: null,
      precisaReautenticar: true,
    };
  }

  const senha = String(form.get('senha') ?? '');
  const conferencia = await reautenticar(senha);

  if (conferencia !== 'certa') {
    return {
      recado: {
        tom: 'erro',
        texto: conferencia === 'errada' ? 'A senha está incorreta.' : RECADO_INDISPONIVEL,
      },
      encerrado: null,
      precisaReautenticar: true,
    };
  }

  return encerrarSessao(anterior, form);
}
