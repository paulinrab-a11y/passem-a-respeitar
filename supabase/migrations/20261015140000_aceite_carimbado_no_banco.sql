-- Issue #309 — funcao de trigger exposta e data do aceite escolhida pelo cliente.
--
-- 1. `anonimiza_pedido()` nasceu na migration 20260924140000, depois da que
--    trancou o EXECUTE das funcoes de trigger (20260923123000). Pelos
--    privilegios padrao do Supabase, `anon` e `authenticated` ficaram com
--    EXECUTE, e o PostgREST lista a funcao em /rest/v1/rpc. Chamada fora de
--    trigger ela so da erro, mas endpoint que ninguem precisa nao fica aberto.
--    O Postgres nao confere EXECUTE ao disparar trigger: revogar nao muda a
--    anonimizacao.
--
-- 2. A trigger do cadastro copiava `termos_aceitos_em` do metadata do signup.
--    A acao do site carimba a hora com o relogio do servidor, mas quem chama
--    `signUp` direto, com a chave publica, manda a data que quiser — um aceite
--    "de anos atras", por exemplo. Agora o banco so le do metadata SE houve
--    aceite; a hora gravada e a da propria transacao que cria a conta.
--
--    O contrato da acao de cadastro nao muda: ela continua mandando
--    `termos_aceitos_em` com uma data valida, e isso continua significando
--    "aceitou". Sem o campo, ou com texto que nao e data, o aceite fica null,
--    como antes.

revoke all on function public.anonimiza_pedido() from public, anon, authenticated;

create or replace function public.cria_profile_no_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aceitou boolean;
begin
  -- O metadata so diz SE houve aceite. A data mandada e descartada: quem
  -- chama o signUp escolhe o metadata, nao o relogio do banco. Texto invalido
  -- conta como "nao aceitou" em vez de derrubar o cadastro.
  begin
    v_aceitou := nullif(trim(new.raw_user_meta_data ->> 'termos_aceitos_em'), '')::timestamptz
      is not null;
  exception when others then
    v_aceitou := false;
  end;

  insert into public.profiles (id, nome, termos_aceitos_em)
  values (
    new.id,
    left(nullif(trim(new.raw_user_meta_data ->> 'nome'), ''), 80),
    case when v_aceitou then now() end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- `create or replace` preserva os privilegios da funcao, mas a trava fica
-- explicita aqui para quem ler esta migration sozinha.
revoke all on function public.cria_profile_no_signup() from public, anon, authenticated;
