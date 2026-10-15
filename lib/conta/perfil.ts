import 'server-only';

import type { User } from '@supabase/supabase-js';
import { clienteServidor, usuarioDaSessao } from '@/lib/supabase/servidor';

/**
 * O que a tela de conta enxerga. Lista fechada, escrita a mao.
 *
 * Nao e o mesmo objeto que vem do banco nem o que vem do `auth.users`. Devolver
 * a linha inteira e como um vazamento comeca: a linha de hoje tem cinco
 * colunas inofensivas, e a de amanha tem uma coluna interna que ninguem
 * lembrou de esconder. Aqui, campo novo so aparece se alguem escrever o nome
 * dele neste arquivo. (Issue #20.)
 */
export type Perfil = {
  nome: string | null;
  email: string;
  emailVerificado: boolean;
  criadoEm: string;
  fotoUrl: string | null;
};

/** Validade da URL assinada da foto. Curta: a pagina e renderizada por request. */
const URL_VALIDA_S = 60 * 10;

function mapeia(
  usuario: User,
  linha: { nome: string | null; criado_em: string } | null,
  fotoUrl: string | null
): Perfil {
  return {
    nome: linha?.nome ?? null,
    email: usuario.email ?? '',
    // O Supabase guarda a data da confirmacao, nao um booleano. Qualquer data
    // significa confirmado; null significa que nunca foi.
    emailVerificado: Boolean(usuario.email_confirmed_at),
    criadoEm: linha?.criado_em ?? usuario.created_at,
    fotoUrl,
  };
}

/**
 * Perfil do usuario da sessao, ou null se nao houver sessao.
 *
 * A query filtra por `user_id` explicitamente mesmo com a RLS ligada. Nao e
 * redundancia inutil: a RLS e a rede embaixo do trapezista, nao o trapezio.
 * Se um dia alguem rodar esta funcao com um client de service_role — numa
 * rota administrativa, por engano — o `eq('id', ...)` ainda segura.
 */
export async function perfilDaSessao(): Promise<Perfil | null> {
  const usuario = await usuarioDaSessao();
  if (!usuario) return null;

  const supabase = await clienteServidor();

  // Colunas nomeadas, nunca `select *`: coluna nova no banco nao vira campo
  // nesta resposta sem alguem decidir.
  const { data } = await supabase
    .from('profiles')
    .select('nome, criado_em, foto_caminho')
    .eq('id', usuario.id)
    .maybeSingle();

  let fotoUrl: string | null = null;

  if (data?.foto_caminho) {
    const { data: assinada } = await supabase.storage
      .from('avatares')
      .createSignedUrl(data.foto_caminho, URL_VALIDA_S);
    fotoUrl = assinada?.signedUrl ?? null;
  }

  return mapeia(usuario, data, fotoUrl);
}

/**
 * Sufixos de geracao que nao sao sobrenome. "Christopher Souza III" vira CS,
 * nao CI; "Joao Pereira Filho" vira JP. So sai do fim, e so de nome com tres
 * partes ou mais: em "Ana Neto", Neto e sobrenome.
 */
const SUFIXOS = new Set(['jr', 'junior', 'júnior', 'filho', 'neto', 'sobrinho', 'ii', 'iii', 'iv']);

// Grafema, nao unidade UTF-16: `'👩‍🚀'[0]` e meio emoji (surrogate solto), e o
// avatar mostra um losango quebrado. O Segmenter devolve o desenho inteiro,
// e tambem segura letra com acento combinante junto da letra.
const grafemas = new Intl.Segmenter('pt-BR', { granularity: 'grapheme' });

function primeiros(texto: string, quantos: number) {
  let saida = '';
  let n = 0;
  for (const { segment } of grafemas.segment(texto)) {
    if (n === quantos) break;
    saida += segment;
    n += 1;
  }
  return saida;
}

/** Iniciais para o lugar da foto. Dois grafemas no maximo. */
export function iniciais(nome: string | null, email: string) {
  const base = (nome?.trim() || email).normalize('NFC');
  const partes = base.split(/[\s@._-]+/).filter(Boolean);

  while (partes.length > 2 && SUFIXOS.has(partes[partes.length - 1].toLocaleLowerCase('pt-BR'))) {
    partes.pop();
  }

  if (partes.length === 0) return '?';
  const letras =
    partes.length === 1
      ? primeiros(partes[0], 2)
      : primeiros(partes[0], 1) + primeiros(partes[partes.length - 1], 1);
  return letras.toLocaleUpperCase('pt-BR');
}
