-- Issue #40 — janela de autenticacao recente.
--
-- A pergunta e "esta pessoa provou a senha ha pouco?". A resposta mais
-- barata e tambem a mais segura: a sessao foi criada quando ela fez login
-- com senha, entao `auth.sessions.created_at` JA e o carimbo que se procura.
--
-- Nao inventei cookie assinado nem tabela nova de propósito. Cookie e dado
-- que o navegador segura, e todo dado que o navegador segura precisa de
-- assinatura, segredo e rotacao. `created_at` esta no servidor, nao passa
-- por lugar nenhum e nao da para forjar.
--
-- E reautenticar tem um efeito bonito nesse desenho: refazer o login cria
-- uma sessao nova, e a janela reinicia sozinha. Nao ha nada para "renovar".
create or replace function public.autenticado_recentemente(p_minutos int default 15)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.sessions s
    where s.id::text = (auth.jwt() ->> 'session_id')
      and s.user_id = (select auth.uid())
      and s.created_at > now() - make_interval(mins => greatest(p_minutos, 1))
  );
$$;

-- `greatest(p_minutos, 1)`: o parametro vem da aplicacao, nao do navegador,
-- mas zero ou negativo transformaria a funcao num "sempre false" silencioso —
-- e um bug desses so aparece quando alguem nao consegue mais fazer nada.

revoke all on function public.autenticado_recentemente(int) from public, anon;
grant execute on function public.autenticado_recentemente(int) to authenticated;

-- ---------------------------------------------------------------------------
-- O identificador da sessao de quem esta pedindo
-- ---------------------------------------------------------------------------

-- Existe por causa de um efeito colateral da reautenticacao: refazer o login
-- cria uma sessao NOVA, e a antiga fica para tras. Ninguem mais segura os
-- cookies dela, entao nao e exploravel — mas ela aparece em "aparelhos
-- conectados" como um aparelho fantasma que a pessoa nao consegue explicar.
-- Numa tela de seguranca, isso e pior que inutil.
--
-- Entao a acao guarda este identificador ANTES de reautenticar e encerra a
-- sessao velha depois, quando ela ja nao e mais a atual e `encerra_sessao`
-- aceita apaga-la.
--
-- Devolve o mesmo hash que `minhas_sessoes`, nunca o id.
create or replace function public.minha_sessao_atual()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(extensions.digest(s.id::text, 'sha256'), 'hex')
  from auth.sessions s
  where s.id::text = (auth.jwt() ->> 'session_id')
    and s.user_id = (select auth.uid());
$$;

revoke all on function public.minha_sessao_atual() from public, anon;
grant execute on function public.minha_sessao_atual() to authenticated;
