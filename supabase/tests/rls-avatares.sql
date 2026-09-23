-- Issues #35 e #26 — teste de RLS do bucket de avatares.
--
-- Pressupoe que existe um perfil com foto. Rode depois de subir uma foto pela
-- tela de conta, trocando o uuid do `dono` abaixo, ou adapte para criar a
-- linha em storage.objects direto.
--
-- Como sempre: todo assert acontece depois de `set local role authenticated`.
-- Rodando como postgres a RLS e ignorada e o teste passaria com o bucket
-- escancarado.

begin;

create temporary table r (caso text, esperado text, obtido text, passou boolean) on commit drop;
grant all on r to authenticated;

do $$
declare
  dono uuid := '00000000-0000-0000-0000-0000000000dd';
  intruso uuid := '00000000-0000-0000-0000-0000000000ee';
  caminho text;
  n int;
begin
  select foto_caminho into caminho from public.profiles where id = dono;
  if caminho is null then
    raise exception 'o usuario % nao tem foto; suba uma antes de rodar este teste', dono;
  end if;

  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
     confirmation_token, recovery_token, email_change_token_new,
     email_change_token_current, email_change, phone_change,
     phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', intruso, 'authenticated', 'authenticated',
    'intruso@teste.invalid', 'sem-login-neste-teste', now(), now(), now(), '{}', '{}',
    '', '', '', '', '', '', '', '');

  -- ---------------------------------------------------------------------
  -- Sessao do intruso
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', intruso, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from storage.objects where bucket_id = 'avatares' and name = caminho;
  insert into r values ('intruso enxerga o arquivo do dono', '0', n::text, n = 0);

  -- Sem filtro: a policy sozinha tem que esconder tudo que nao e dele.
  select count(*) into n from storage.objects where bucket_id = 'avatares';
  insert into r values ('intruso lista o bucket', '0', n::text, n = 0);

  select count(*) into n from public.profiles where id = dono;
  insert into r values ('intruso le o profile do dono', '0', n::text, n = 0);

  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('avatares', caminho || '.x', dono);
    insert into r values ('intruso escreve na pasta do dono', 'erro', 'passou', false);
  exception when others then
    insert into r values ('intruso escreve na pasta do dono', 'erro', 'bloqueado', true);
  end;

  -- ---------------------------------------------------------------------
  -- Sessao do dono
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', dono, 'role', 'authenticated')::text, true);

  select count(*) into n from storage.objects where bucket_id = 'avatares' and name = caminho;
  insert into r values ('dono enxerga a propria foto', '1', n::text, n = 1);

  reset role;
  perform set_config('request.jwt.claims', null, true);
  delete from auth.users where id = intruso;
end;
$$;

select case when passou then 'ok' else 'FALHA' end as res, caso, esperado, obtido from r;

select count(*) filter (where passou) as passou, count(*) filter (where not passou) as falhou from r;

commit;
