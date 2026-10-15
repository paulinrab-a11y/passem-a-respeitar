-- Issue #38 — isolamento das funcoes de sessao.
--
-- `minhas_sessoes` e `encerra_sessao` sao SECURITY DEFINER, e o advisor do
-- Supabase avisa sobre isso. O aviso esta certo em apontar: elas leem
-- `auth.sessions`, que `authenticated` nao alcanca, e por isso o filtro por
-- `auth.uid()` DENTRO da funcao nao e segunda barreira — e a unica.
--
-- Este teste e o que justifica o aviso ficar sem acao. Roda como
-- `authenticated`, com o JWT de um intruso, contra as sessoes de outro.
--
-- O cenario nasce aqui dentro (#335): o dono e uma sessao dele em
-- `auth.sessions`, como o login cria. Termina em `rollback`.
--
-- #349: `encerra_sessao` passou a exigir autenticacao recente dentro da
-- propria funcao. O intruso agora tem uma sessao recente dele (sem ela a
-- recusa viria da janela, e o caso deixaria de provar o filtro por dono), e o
-- dono prova os dois lados da janela.

begin;

create temporary table r (caso text, esperado text, obtido text, passou boolean) on commit drop;
grant all on r to authenticated;

do $$
declare
  dono uuid := '00000000-0000-0000-0000-000000005e55';
  intruso uuid := '00000000-0000-0000-0000-00000000bad1';
  hash_alheio text;
  sessao_intruso uuid := gen_random_uuid();
  velha uuid := gen_random_uuid();
  nova uuid := gen_random_uuid();
  n int;
  ok boolean;
  estado text;
begin
  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
     confirmation_token, recovery_token, email_change_token_new,
     email_change_token_current, email_change, phone_change,
     phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', dono, 'authenticated', 'authenticated',
    'dono-sessao@teste.invalid', 'sem-login-neste-teste', now(), now(), now(), '{}', '{}',
    '', '', '', '', '', '', '', '');

  insert into auth.sessions (id, user_id, created_at, updated_at)
  values (gen_random_uuid(), dono, now(), now());

  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
     confirmation_token, recovery_token, email_change_token_new,
     email_change_token_current, email_change, phone_change,
     phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', intruso, 'authenticated', 'authenticated',
    'intruso-sessao@teste.invalid', 'sem-login-neste-teste', now(), now(), now(), '{}', '{}',
    '', '', '', '', '', '', '', '');

  insert into auth.sessions (id, user_id, created_at, updated_at)
  values (sessao_intruso, intruso, now(), now());

  -- Duas sessoes a mais do dono: uma de login antigo, fora da janela de 15
  -- minutos, e uma de agora.
  insert into auth.sessions (id, user_id, created_at, updated_at)
  values (velha, dono, now() - interval '1 hour', now()),
         (nova, dono, now(), now());

  select encode(extensions.digest(s.id::text, 'sha256'), 'hex') into hash_alheio
  from auth.sessions s where s.user_id = dono and s.id not in (velha, nova) limit 1;

  -- ---------------------------------------------------------------------
  -- Sessao do intruso, segurando um hash que nao e dele
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', intruso, 'role', 'authenticated',
      'session_id', sessao_intruso)::text, true);
  set local role authenticated;

  select count(*) into n from public.minhas_sessoes();
  insert into r values ('intruso lista sessoes', '0', n::text, n = 0);

  select public.encerra_sessao(hash_alheio) into ok;
  insert into r values ('intruso encerra sessao alheia', 'false', ok::text, ok = false);

  reset role;
  perform set_config('request.jwt.claims', null, true);

  select count(*) into n from auth.sessions where user_id = dono;
  insert into r values ('sessoes do dono continuam vivas', '>0', n::text, n > 0);

  -- ---------------------------------------------------------------------
  -- Dono com login antigo: a funcao recusa, mesmo chamada direto pela API
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', dono, 'role', 'authenticated', 'session_id', velha)::text, true);
  set local role authenticated;

  estado := 'passou';
  begin
    perform public.encerra_sessao(encode(extensions.digest(nova::text, 'sha256'), 'hex'));
  exception when insufficient_privilege then
    estado := 'recusada';
  end;
  insert into r values ('sessao velha encerra outra (#349)', 'recusada', estado,
    estado = 'recusada');

  reset role;
  select count(*) into n from auth.sessions where id = nova;
  insert into r values ('a sessao alvo continua viva', '1', n::text, n = 1);

  -- ---------------------------------------------------------------------
  -- Dono com login recente: encerra a outra
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', dono, 'role', 'authenticated', 'session_id', nova)::text, true);
  set local role authenticated;

  select public.encerra_sessao(encode(extensions.digest(velha::text, 'sha256'), 'hex')) into ok;
  insert into r values ('sessao recente encerra outra', 'true', ok::text, ok = true);

  reset role;
  perform set_config('request.jwt.claims', null, true);

  select count(*) into n from auth.sessions where id = velha;
  insert into r values ('a sessao velha sumiu', '0', n::text, n = 0);
end;
$$;

select case when passou then 'ok' else 'FALHA' end as res, caso, esperado, obtido from r;
select count(*) filter (where passou) as passou, count(*) filter (where not passou) as falhou from r;

rollback;
