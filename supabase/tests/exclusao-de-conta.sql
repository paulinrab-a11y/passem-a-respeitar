-- Issue #39 — exclusao de conta com anonimizacao do pedido.
--
-- Duas perguntas, e as duas importam:
--
-- 1. O pedido sobrevive a exclusao, sem dono? (LGPD de um lado, obrigacao
--    fiscal do outro.)
-- 2. A excecao que abri no trigger `pedido_dono_imutavel` e mesmo de mao
--    unica? Ela precisou existir porque `on delete set null` dispara um
--    UPDATE, e o trigger barraria a propria exclusao da conta. Uma excecao
--    larga demais transferiria pedido de uma pessoa para outra.

begin;

create temporary table r (caso text, esperado text, obtido text, passou boolean) on commit drop;

-- ---------------------------------------------------------------------------
-- O que some e o que fica
-- ---------------------------------------------------------------------------
do $$
declare
  alvo uuid := '00000000-0000-0000-0000-0000000de1e7';
  pedido uuid;
  n int;
  t timestamptz;
begin
  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
     confirmation_token, recovery_token, email_change_token_new,
     email_change_token_current, email_change, phone_change,
     phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', alvo, 'authenticated', 'authenticated',
    'excluir-teste@exemplo.invalid', 'sem-login-neste-teste', now(), now(), now(),
    '{}', '{"nome":"Vai Sumir"}', '', '', '', '', '', '', '', '');

  insert into public.orders (user_id, total_centavos, status)
  values (alvo, 12900, 'entregue') returning id into pedido;

  insert into public.order_items
    (order_id, produto_slug, nome, tamanho, quantidade, preco_unitario_centavos)
  values (pedido, 'camiseta-par', 'Camiseta Passem a Respeitar', 'G', 1, 12900);

  -- O que a acao faz, na ordem em que faz
  update public.orders set anonimizado_em = now() where user_id = alvo;
  delete from auth.users where id = alvo;

  select count(*) into n from auth.users where id = alvo;
  insert into r values ('usuario apagado', '0', n::text, n = 0);

  select count(*) into n from public.profiles where id = alvo;
  insert into r values ('perfil foi junto, por cascade', '0', n::text, n = 0);

  select count(*) into n from public.orders where id = pedido;
  insert into r values ('pedido continua existindo', '1', n::text, n = 1);

  select count(*) into n from public.orders where id = pedido and user_id is null;
  insert into r values ('pedido perdeu o dono', '1', n::text, n = 1);

  select anonimizado_em into t from public.orders where id = pedido;
  insert into r values ('pedido marcado como anonimizado', 'sim',
    case when t is null then 'nao' else 'sim' end, t is not null);

  select total_centavos into n from public.orders where id = pedido;
  insert into r values ('valor da venda preservado', '12900', n::text, n = 12900);

  select count(*) into n from public.order_items where order_id = pedido;
  insert into r values ('itens do pedido preservados', '1', n::text, n = 1);

  delete from public.orders where id = pedido;
end;
$$;

-- ---------------------------------------------------------------------------
-- A excecao do trigger e de mao unica
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000aa';
  b uuid := '00000000-0000-0000-0000-0000000000bb';
  pedido_a uuid;
begin
  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
     confirmation_token, recovery_token, email_change_token_new,
     email_change_token_current, email_change, phone_change,
     phone_change_token, reauthentication_token)
  values
    ('00000000-0000-0000-0000-000000000000', a, 'authenticated', 'authenticated',
     'a@teste.invalid', 'sem-login-neste-teste', now(), now(), now(), '{}', '{}',
     '', '', '', '', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', b, 'authenticated', 'authenticated',
     'b@teste.invalid', 'sem-login-neste-teste', now(), now(), now(), '{}', '{}',
     '', '', '', '', '', '', '', '');

  insert into public.orders (user_id, total_centavos) values (a, 12900) returning id into pedido_a;

  begin
    update public.orders set user_id = b where id = pedido_a;
    insert into r values ('transferir pedido de A para B', 'erro', 'passou', false);
  exception when check_violation then
    insert into r values ('transferir pedido de A para B', 'erro', 'bloqueado', true);
  end;

  begin
    update public.orders set user_id = null where id = pedido_a;
    insert into r values ('anonimizar (dono -> nulo)', 'permitido', 'permitido', true);
  exception when others then
    insert into r values ('anonimizar (dono -> nulo)', 'permitido', 'bloqueado', false);
  end;

  -- Pedido anonimizado nao ganha dono de volta: se ganhasse, "anonimizar"
  -- seria reversivel e a anonimizacao nao valeria nada.
  begin
    update public.orders set user_id = b where id = pedido_a;
    insert into r values ('dar dono a pedido anonimizado', 'erro', 'passou', false);
  exception when check_violation then
    insert into r values ('dar dono a pedido anonimizado', 'erro', 'bloqueado', true);
  end;

  delete from public.orders where id = pedido_a;
  delete from auth.users where id in (a, b);
end;
$$;

select case when passou then 'ok' else 'FALHA' end as res, caso, esperado, obtido from r;
select count(*) filter (where passou) as passou, count(*) filter (where not passou) as falhou from r;

commit;
