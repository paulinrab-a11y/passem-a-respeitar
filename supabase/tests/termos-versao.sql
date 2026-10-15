-- Issue #380 — versao dos termos gravada no pedido.
--
-- As duas `cria_pedido` convivem ate o deploy (migration 20261015200000):
--   - a de 6 parametros continua criando pedido, com a versao nula, como o
--     codigo em producao espera;
--   - a de 7 grava a versao, e recusa pedido sem ela;
--   - so o service_role executa a nova.
--
-- Transacao desfeita no fim, como cria-pedido.sql.

select
  pg_get_function_identity_arguments(p.oid) as parametros,
  case
    when has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'FALHOU'
    when not has_function_privilege('service_role', p.oid, 'EXECUTE') then 'FALHOU'
    when p.prosecdef then 'FALHOU'
    else 'OK'
  end as veredito
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'cria_pedido'
  and pg_get_function_identity_arguments(p.oid) like '%p_termos_versao text';

begin;

create temporary table r (caso text, esperado text, obtido text, passou boolean) on commit drop;

do $$
declare
  quem uuid := '00000000-0000-0000-0000-00000000380a';
  endereco jsonb := '{"entrega_nome":"Teste Versao","entrega_cep":"01310100","entrega_logradouro":"Avenida Paulista","entrega_numero":"1578","entrega_bairro":"Bela Vista","entrega_cidade":"Sao Paulo","entrega_uf":"SP"}';
  frete jsonb := '{"centavos":2350,"servico":"sedex","prazo_dias":3}';
  itens jsonb := '[{"produto_slug":"teste-versao","nome":"Teste","tamanho":"M","quantidade":1,"preco_unitario_centavos":12000}]';
  produto uuid;
  pedido uuid;
  v text;
begin
  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
     confirmation_token, recovery_token, email_change_token_new,
     email_change_token_current, email_change, phone_change,
     phone_change_token, reauthentication_token)
  values
    ('00000000-0000-0000-0000-000000000000', quem, 'authenticated', 'authenticated',
     'versao-teste@exemplo.invalid', 'sem-login-neste-teste', now(), now(), now(),
     '{}', '{}', '', '', '', '', '', '', '', '');

  insert into public.produtos (slug, nome) values ('teste-versao', 'Teste de versao')
  returning id into produto;
  -- Estoque nao contado: nenhuma reserva prende a segunda compra.
  insert into public.produto_variacoes (produto_id, tamanho, preco_centavos, estoque, ativo, ordem)
  values (produto, 'M', 12000, null, true, 1);

  -- A nova grava a versao.
  select c.pedido_id into pedido
  from public.cria_pedido(quem, 14350, endereco, itens, frete, now(), '2026-10-15T20:00:00-03:00') as c;
  select termos_versao into v from public.orders where id = pedido;
  insert into r values ('7 parametros grava a versao', '2026-10-15T20:00:00-03:00', coalesce(v, 'nula'),
    v = '2026-10-15T20:00:00-03:00');

  -- A antiga, que producao chama, continua criando — com a versao nula.
  select c.pedido_id into pedido
  from public.cria_pedido(quem, 14350, endereco, itens, frete, now()) as c;
  select termos_versao into v from public.orders where id = pedido;
  insert into r values ('6 parametros continua criando', 'nula', coalesce(v, 'nula'), v is null);

  -- Sem a versao, a nova recusa.
  begin
    perform public.cria_pedido(quem, 14350, endereco, itens, frete, now(), null::text);
    insert into r values ('7 parametros sem versao', '23514', 'criou', false);
  exception when check_violation then
    insert into r values ('7 parametros sem versao', '23514', '23514', true);
  end;

  -- Versao absurda nao entra.
  begin
    perform public.cria_pedido(quem, 14350, endereco, itens, frete, now(), repeat('x', 41));
    insert into r values ('versao longa demais', '23514', 'criou', false);
  exception when check_violation then
    insert into r values ('versao longa demais', '23514', '23514', true);
  end;
end;
$$;

select case when passou then 'ok' else 'FALHA' end as res, caso, esperado, obtido from r;

rollback;
