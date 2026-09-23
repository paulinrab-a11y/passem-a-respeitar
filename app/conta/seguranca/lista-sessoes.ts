import 'server-only';

// Nome com hifen, e nao `sessoes.ts`, porque `Sessoes.tsx` mora ao lado: dois
// arquivos que diferem so em maiuscula quebram em Windows e macOS. Ja pisei
// nisso na #33, com Sair.tsx e sair.ts.

import { mapeiaSessoes, type Sessao } from '@/lib/conta/sessoes';
import { clienteServidor, usuarioDaSessao } from '@/lib/supabase/servidor';

/**
 * Sessoes do usuario da sessao.
 *
 * O filtro por usuario esta DENTRO da funcao do banco, nao aqui: ela le
 * `auth.sessions`, que o cliente nao alcanca de jeito nenhum. Ver a migration
 * 20260923190000.
 */
export async function minhasSessoes(): Promise<Sessao[]> {
  if (!(await usuarioDaSessao())) return [];

  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc('minhas_sessoes');

  if (error || !data) return [];
  return mapeiaSessoes(data);
}
