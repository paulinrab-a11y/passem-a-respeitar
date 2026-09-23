-- Issue #38 — isolamento das funcoes de sessao.
--
-- `minhas_sessoes` e `encerra_sessao` sao SECURITY DEFINER, e o advisor do
-- Supabase avisa sobre isso. O aviso esta certo em apontar: elas leem
-- `auth.sessions`, que `authenticated` nao alcanca, e por isso o filtro por
-- `auth.uid()` DENTRO da funcao nao e segunda barreira — e a unica.
--
-- Este teste e o que justifica o aviso ficar sem acao. Roda como
-- `authenticated`, com o JWT de um intruso, contra as sessoes de outro.

begin;

create temporary table r (caso text, esperado text, obtido text, passou boolean) on commit drop;
grant all on r to authenticated;

do $$
declare
  dono uuid := '00000000-0000-0000-0000-000000005e55';
  intruso uuid := '00000000-0000-0000-0000-00000000bad1';
  hash_alheio text;
  n int;
  ok boolean;
begin
  if not exists (select 1 from auth.sessions where user_id = dono) then
    raise exception 'o usuario % nao tem sessao; logue antes de rodar este teste', dono;
  end if;

  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
     confirmation_token, recovery_token, email_change_token_new,
     email_change_token_current, email_change, phone_change,
     phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', intruso, 'authenticated', 'authenticated',
    'intruso-sessao@teste.invalid', 'sem-login-neste-teste', now(), now(), now(), '{}', '{}',
    '', '', '', '', '', '', '', '');

  select encode(extensions.digest(s.id::text, 'sha256'), 'hex') into hash_alheio
  from auth.sessions s where s.user_id = dono limit 1;

  -- ---------------------------------------------------------------------
  -- Sessao do intruso, segurando um hash que nao e dele
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', intruso, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.minhas_sessoes();
  insert into r values ('intruso lista sessoes', '0', n::text, n = 0);

  select public.encerra_sessao(hash_alheio) into ok;
  insert into r values ('intruso encerra sessao alheia', 'false', ok::text, ok = false);

  reset role;
  perform set_config('request.jwt.claims', null, true);

  select count(*) into n from auth.sessions where user_id = dono;
  insert into r values ('sessoes do dono continuam vivas', '>0', n::text, n > 0);

  delete from auth.users where id = intruso;
end;
$$;

select case when passou then 'ok' else 'FALHA' end as res, caso, esperado, obtido from r;
select count(*) filter (where passou) as passou, count(*) filter (where not passou) as falhou from r;

commit;
