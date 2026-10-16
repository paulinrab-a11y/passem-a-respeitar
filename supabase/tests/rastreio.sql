-- Issue #378 — codigo de rastreio e a porta `envia_pedido`.
--
-- O que tem que continuar verdade:
--   - so o service_role executa `envia_pedido` (o padrao do Supabase daria
--     EXECUTE a todo mundo);
--   - status e rastreio mudam juntos, e so de `em_producao`;
--   - codigo fora do formato dos Correios nao entra, e o status nao muda;
--   - o dono le o proprio rastreio, nao o do vizinho, e nao escreve nele;
--   - `muda_status_pedido` nao marca enviado: a porta e so esta (#391).
--
-- Mesmo formato de rls-pedidos.sql: tudo numa transacao, desfeita no fim.

select
  p.proname,
  case when p.prosecdef then 'DEFINER' else 'INVOKER' end as seguranca,
  case
    when has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'FALHOU'
    when not has_function_privilege('service_role', p.oid, 'EXECUTE') then 'FALHOU'
    when p.prosecdef then 'FALHOU'
    else 'OK'
  end as veredito
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'envia_pedido';

begin;

create temporary table resultado (
  caso text,
  esperado text,
  obtido text,
  passou boolean
) on commit drop;

grant all on resultado to authenticated;

do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000003aa';
  b uuid := '00000000-0000-0000-0000-0000000003bb';
  quem uuid := '00000000-0000-0000-0000-0000000003cc';
  pedido_a uuid;
  pedido_b uuid;
  v_status text;
  v_codigo text;
  v_url text;
  n int;
begin
  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at,
     raw_app_meta_data, raw_user_meta_data)
  values
    ('00000000-0000-0000-0000-000000000000', a, 'authenticated', 'authenticated',
     'rastreio-a@teste.invalid', 'sem-login', now(), now(), now(), '{"provider":"email"}', '{}'),
    ('00000000-0000-0000-0000-000000000000', b, 'authenticated', 'authenticated',
     'rastreio-b@teste.invalid', 'sem-login', now(), now(), now(), '{"provider":"email"}', '{}'),
    ('00000000-0000-0000-0000-000000000000', quem, 'authenticated', 'authenticated',
     'rastreio-admin@teste.invalid', 'sem-login', now(), now(), now(), '{"provider":"email"}', '{}');

  insert into public.orders (user_id, total_centavos, status)
  values (a, 12900, 'pago') returning id into pedido_a;
  insert into public.orders (user_id, total_centavos, status)
  values (b, 12900, 'em_producao') returning id into pedido_b;

  -- ---------------------------------------------------------------------
  -- A porta, como postgres (no lugar do service_role)
  -- ---------------------------------------------------------------------

  -- De `pago` nao se envia: tem que passar por producao.
  begin
    perform public.envia_pedido(pedido_a, quem, 'AB123456789BR');
    insert into resultado values ('envia de pago', 'erro P0001', 'passou', false);
  exception when sqlstate 'P0001' then
    insert into resultado values ('envia de pago', 'erro P0001', 'erro P0001', true);
  end;

  update public.orders set status = 'em_producao' where id = pedido_a;

  -- Codigo fora do formato: a constraint recusa, e o status fica.
  begin
    perform public.envia_pedido(pedido_a, quem, 'ab123456789br');
    insert into resultado values ('codigo minusculo', 'erro 23514', 'passou', false);
  exception when check_violation then
    insert into resultado values ('codigo minusculo', 'erro 23514', 'erro 23514', true);
  end;

  begin
    perform public.envia_pedido(pedido_a, quem, 'AB12345678BR');
    insert into resultado values ('codigo com 8 digitos', 'erro 23514', 'passou', false);
  exception when check_violation then
    insert into resultado values ('codigo com 8 digitos', 'erro 23514', 'erro 23514', true);
  end;

  begin
    perform public.envia_pedido(pedido_a, quem, 'AB123456789BR', 'http://inseguro.test/x');
    insert into resultado values ('url sem https', 'erro 23514', 'passou', false);
  exception when check_violation then
    insert into resultado values ('url sem https', 'erro 23514', 'erro 23514', true);
  end;

  begin
    perform public.envia_pedido(pedido_a, quem, null);
    insert into resultado values ('sem codigo', 'erro 22004', 'passou', false);
  exception when sqlstate '22004' then
    insert into resultado values ('sem codigo', 'erro 22004', 'erro 22004', true);
  end;

  -- A porta antiga nao serve mais para enviado (#391): sem codigo, nao sai.
  begin
    perform public.muda_status_pedido(pedido_a, 'enviado', quem);
    insert into resultado values ('muda_status_pedido para enviado', 'erro P0001', 'passou', false);
  exception when sqlstate 'P0001' then
    insert into resultado values ('muda_status_pedido para enviado', 'erro P0001', 'erro P0001', true);
  end;

  select status::text into v_status from public.orders where id = pedido_a;
  insert into resultado values ('recusa nao muda o status', 'em_producao', v_status, v_status = 'em_producao');

  -- O caminho certo: status e codigo juntos, autor e motivo na trilha.
  perform public.envia_pedido(pedido_a, quem, 'AB123456789BR', 'https://rastreio.test/AB123456789BR', 'postado');

  select status::text, rastreio_codigo, rastreio_url into v_status, v_codigo, v_url
  from public.orders where id = pedido_a;
  insert into resultado values ('envia grava status', 'enviado', v_status, v_status = 'enviado');
  insert into resultado values ('envia grava codigo', 'AB123456789BR', v_codigo, v_codigo = 'AB123456789BR');
  insert into resultado values ('envia grava url', 'https://rastreio.test/AB123456789BR', v_url, v_url = 'https://rastreio.test/AB123456789BR');

  select count(*) into n from public.order_status_history
   where order_id = pedido_a and de = 'em_producao' and para = 'enviado'
     and autor = quem and motivo = 'postado';
  insert into resultado values ('trilha com autor e motivo', '1', n::text, n = 1);

  -- Ja enviado nao se envia de novo.
  begin
    perform public.envia_pedido(pedido_a, quem, 'CD987654321BR');
    insert into resultado values ('envia duas vezes', 'erro P0001', 'passou', false);
  exception when sqlstate 'P0001' then
    insert into resultado values ('envia duas vezes', 'erro P0001', 'erro P0001', true);
  end;

  perform public.envia_pedido(pedido_b, quem, 'CD987654321BR');

  -- Depois de enviado, o resto continua pela porta de sempre.
  perform public.muda_status_pedido(pedido_a, 'entregue', quem);
  select status::text into v_status from public.orders where id = pedido_a;
  insert into resultado values ('muda_status_pedido de enviado para entregue', 'entregue', v_status, v_status = 'entregue');

  -- ---------------------------------------------------------------------
  -- Sessao do usuario A
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select rastreio_codigo into v_codigo from public.orders where id = pedido_a;
  insert into resultado values ('A le o proprio rastreio', 'AB123456789BR', coalesce(v_codigo, 'nada'), v_codigo = 'AB123456789BR');

  select count(*) into n from public.orders where id = pedido_b and rastreio_codigo is not null;
  insert into resultado values ('A le o rastreio de B', '0', n::text, n = 0);

  begin
    update public.orders set rastreio_codigo = 'ZZ000000000BR' where id = pedido_a;
    insert into resultado values ('A escreve o proprio rastreio', 'erro', 'passou', false);
  exception when insufficient_privilege then
    insert into resultado values ('A escreve o proprio rastreio', 'erro', 'erro', true);
  end;

  begin
    perform public.envia_pedido(pedido_a, a, 'ZZ000000000BR');
    insert into resultado values ('A chama envia_pedido', 'erro', 'passou', false);
  exception when insufficient_privilege then
    insert into resultado values ('A chama envia_pedido', 'erro', 'erro', true);
  end;

  reset role;
  perform set_config('request.jwt.claims', null, true);

  delete from public.orders where user_id in (a, b);
  delete from auth.users where id in (a, b, quem);
end;
$$;

select
  case when passou then 'ok' else 'FALHA' end as r,
  caso,
  esperado,
  obtido
from resultado;

commit;
