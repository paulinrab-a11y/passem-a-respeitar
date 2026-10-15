-- Issue #349 — duas permissoes mais largas do que o app precisa.

-- ---------------------------------------------------------------------------
-- 1. Historico do pedido: so as colunas que a conta mostra
-- ---------------------------------------------------------------------------

-- A #18 deu `select` na tabela inteira para `authenticated`. A RLS ja limita
-- as LINHAS ao dono do pedido, mas as COLUNAS vinham todas: `motivo` (texto
-- livre que o admin escreve ao mudar o status) e `autor` (o id de quem
-- mudou) chegavam a qualquer cliente que pedisse pela API, mesmo que a tela
-- nunca mostre. Mesma regra do `update (nome, telefone)` em profiles: quem
-- decide coluna e o GRANT, nao a policy.
--
-- O que fica e o que a linha do tempo da conta usa (lib/conta/pedidos.ts e
-- app/conta/pedidos/[id]/busca-pedido.ts: `order_status_history(para,
-- criado_em)`), mais `order_id`, que o PostgREST usa para juntar com o
-- pedido, e `id`. O painel do admin le a trilha completa pela chave de
-- servico, que nao passa por aqui.
revoke select on public.order_status_history from authenticated;
grant select (id, order_id, para, criado_em) on public.order_status_history to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Encerrar sessao exige autenticacao recente dentro da funcao
-- ---------------------------------------------------------------------------

-- `encerra_sessao` e SECURITY DEFINER e o EXECUTE e de `authenticated`: um
-- token roubado chamava a RPC direto, sem passar pela acao do servidor, que
-- era o unico lugar onde a janela da #40 era conferida. Agora a funcao
-- confere sozinha, com a mesma janela de lib/conta/reautenticacao.ts
-- (JANELA_MINUTOS = 15). A acao continua conferindo antes, para a tela
-- pedir a senha em vez de mostrar erro.
--
-- Quem a chama hoje:
--   - app/conta/seguranca/acoes.ts, depois de `autenticadoRecentemente()`;
--   - lib/conta/reautenticacao.ts, logo DEPOIS de refazer o login, com a
--     sessao nova (recente por definicao) encerrando a velha.
-- Nenhum dos dois muda.
--
-- Sessao velha recebe erro 42501, e nao `false`: `false` ja quer dizer "nao
-- achei essa sessao", e as duas coisas pedem respostas diferentes.
create or replace function public.encerra_sessao(p_identificador text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  alvo uuid;
begin
  if not public.autenticado_recentemente(15) then
    raise exception 'autenticacao recente exigida'
      using errcode = '42501';
  end if;

  select s.id into alvo
  from auth.sessions s
  where s.user_id = (select auth.uid())
    and encode(extensions.digest(s.id::text, 'sha256'), 'hex') = p_identificador
    and s.id::text is distinct from (auth.jwt() ->> 'session_id');

  if alvo is null then
    return false;
  end if;

  -- Apagar a sessao leva junto o refresh token dela, por cascade. E isso que
  -- torna o encerramento efetivo no servidor, e nao so na tela.
  delete from auth.sessions where id = alvo;
  return true;
end;
$$;

-- `create or replace` preserva os privilegios, mas a regra fica escrita aqui
-- de novo: quem le so esta migration ve quem pode chamar.
revoke all on function public.encerra_sessao(text) from public, anon;
grant execute on function public.encerra_sessao(text) to authenticated;
