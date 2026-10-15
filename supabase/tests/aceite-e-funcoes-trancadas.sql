-- Issue #309 — aceite carimbado pelo banco e funcao de trigger trancada.
--
-- Duas perguntas:
--
-- 1. Quem chama o signUp direto, com uma data inventada no metadata, consegue
--    gravar essa data como hora do aceite? (Nao pode.)
-- 2. Sobrou funcao de trigger chamavel por `anon` ou `authenticated` pelo
--    /rest/v1/rpc? (Nao pode.)
--
-- Roda inteiro dentro de uma transacao, e nada fica no banco.

begin;

create temporary table r (caso text, esperado text, obtido text, passou boolean) on commit drop;

do $$
declare
  forjado uuid := '00000000-0000-0000-0000-0000000ace01';
  sem_aceite uuid := '00000000-0000-0000-0000-0000000ace02';
  lixo uuid := '00000000-0000-0000-0000-0000000ace03';
  t timestamptz;
begin
  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
     confirmation_token, recovery_token, email_change_token_new,
     email_change_token_current, email_change, phone_change,
     phone_change_token, reauthentication_token)
  values
    ('00000000-0000-0000-0000-000000000000', forjado, 'authenticated', 'authenticated',
     'aceite-forjado@exemplo.invalid', 'sem-login-neste-teste', now(), now(), now(),
     '{}', '{"termos_aceitos_em":"1999-01-01T00:00:00Z"}', '', '', '', '', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', sem_aceite, 'authenticated', 'authenticated',
     'sem-aceite@exemplo.invalid', 'sem-login-neste-teste', now(), now(), now(),
     '{}', '{}', '', '', '', '', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', lixo, 'authenticated', 'authenticated',
     'aceite-lixo@exemplo.invalid', 'sem-login-neste-teste', now(), now(), now(),
     '{}', '{"termos_aceitos_em":"ontem"}', '', '', '', '', '', '', '', '');

  -- now() e a hora da transacao: a mesma em que a conta nasceu.
  select termos_aceitos_em into t from public.profiles where id = forjado;
  insert into r values ('data forjada vira a hora do banco', now()::text, coalesce(t::text, 'null'),
    t = now());

  select termos_aceitos_em into t from public.profiles where id = sem_aceite;
  insert into r values ('sem aceite no metadata', 'null', coalesce(t::text, 'null'), t is null);

  select termos_aceitos_em into t from public.profiles where id = lixo;
  insert into r values ('texto que nao e data', 'null', coalesce(t::text, 'null'), t is null);

  delete from auth.users where id in (forjado, sem_aceite, lixo);
end;
$$;

-- Toda funcao que so existe para trigger: ninguem de fora executa.
insert into r
select
  'sem EXECUTE para anon/authenticated: ' || p.proname,
  'false/false',
  has_function_privilege('anon', p.oid, 'EXECUTE')::text || '/' ||
    has_function_privilege('authenticated', p.oid, 'EXECUTE')::text,
  not has_function_privilege('anon', p.oid, 'EXECUTE')
    and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prorettype = 'trigger'::regtype;

select case when passou then 'ok' else 'FALHA' end as res, caso, esperado, obtido from r;
select count(*) filter (where passou) as passou, count(*) filter (where not passou) as falhou from r;

commit;
