-- Issue #38 — ver e encerrar sessoes.
--
-- As sessoes vivem em `auth.sessions`, que o PostgREST nao expoe e nem
-- deveria. Estas duas funcoes sao a unica porta, e cada uma filtra por
-- `auth.uid()` por dentro.
--
-- SECURITY DEFINER aqui e necessario — `authenticated` nao le `auth.sessions`
-- — e por isso o filtro nao e "segunda barreira", e a unica. Ele esta escrito
-- dentro da funcao, onde quem chama nao alcanca.

/**
 * O identificador que sai daqui e o SHA-256 do id da sessao, nunca o id.
 *
 * A Issue pede resposta sem identificador interno. O hash resolve sem inventar
 * segredo: ele so tem sentido comparado com os hashes das sessoes DESTE
 * usuario, e e o que `encerra_sessao` faz.
 */
create or replace function public.minhas_sessoes()
returns table (
  identificador text,
  criada_em timestamptz,
  ultimo_acesso timestamptz,
  agente text,
  rede text,
  e_a_atual boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    encode(extensions.digest(s.id::text, 'sha256'), 'hex'),
    s.created_at,
    coalesce(s.refreshed_at, s.updated_at, s.created_at),
    s.user_agent,
    -- IP mascarado na origem: os dois ultimos octetos nao saem do banco. Nao
    -- da para "vazar sem querer" um dado que a funcao nunca devolveu.
    case
      when s.ip is null then null
      when family(s.ip) = 4 then host(network(set_masklen(s.ip::cidr, 16)))
      else host(network(set_masklen(s.ip::cidr, 32)))
    end,
    s.id::text = (auth.jwt() ->> 'session_id')
  from auth.sessions s
  where s.user_id = (select auth.uid())
  order by coalesce(s.refreshed_at, s.updated_at, s.created_at) desc;
$$;

/**
 * Encerra uma sessao. Devolve true se achou e apagou.
 *
 * A sessao atual e recusada de proposito: encerrar a si mesmo por um botao de
 * lista e "sair" disfarcado, e sair tem o proprio botao. Alem disso a Issue
 * pede que a atual nao seja encerravel por engano.
 */
create or replace function public.encerra_sessao(p_identificador text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  alvo uuid;
begin
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

revoke all on function public.minhas_sessoes() from public, anon;
revoke all on function public.encerra_sessao(text) from public, anon;
grant execute on function public.minhas_sessoes() to authenticated;
grant execute on function public.encerra_sessao(text) to authenticated;
