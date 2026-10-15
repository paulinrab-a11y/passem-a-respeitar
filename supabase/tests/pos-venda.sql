-- Issue #379 — solicitacoes de pos-venda (cancelar, desistir, trocar, defeito).
--
-- A regra de quando cabe pedir mora no banco, entao e aqui que ela se prova:
--   - a pessoa cria so para pedido dela, so no status certo, so no prazo;
--   - uma aberta por pedido e tipo;
--   - ela nao escolhe dono, protocolo nem "ja resolvida";
--   - le as proprias, nao as do vizinho, e nao apaga nem edita;
--   - cancelar ou reembolsar o pedido encerra as abertas.
--
-- Mesmo formato de rls-pedidos.sql: tudo numa transacao, desfeita no fim.

-- A funcao de trigger nao e endpoint. A da policy e de authenticated.
select
  p.proname,
  case
    when p.proname = 'encerra_solicitacoes_do_pedido'
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')) then 'FALHOU'
    when p.proname = 'pos_venda_cabe'
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or not has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or p.prosecdef) then 'FALHOU'
    else 'OK'
  end as veredito
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('encerra_solicitacoes_do_pedido', 'pos_venda_cabe')
order by p.proname;

-- RLS ligada e anon sem nada.
select
  c.relname,
  case
    when not c.relrowsecurity then 'FALHOU'
    when has_table_privilege('anon', c.oid, 'SELECT')
      or has_table_privilege('anon', c.oid, 'INSERT') then 'FALHOU'
    when has_table_privilege('authenticated', c.oid, 'UPDATE')
      or has_table_privilege('authenticated', c.oid, 'DELETE') then 'FALHOU'
    else 'OK'
  end as veredito
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'solicitacoes_pos_venda';

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
  a uuid := '00000000-0000-0000-0000-0000000004aa';
  b uuid := '00000000-0000-0000-0000-0000000004bb';
  aguardando uuid;
  pago uuid;
  producao uuid;
  enviado uuid;
  entregue_ontem uuid;
  entregue_velho uuid;
  entregue_sem_data uuid;
  pedido_b uuid;
  v_protocolo text;
  v_dono uuid;
  n int;
begin
  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at,
     raw_app_meta_data, raw_user_meta_data)
  values
    ('00000000-0000-0000-0000-000000000000', a, 'authenticated', 'authenticated',
     'pos-venda-a@teste.invalid', 'sem-login', now(), now(), now(), '{"provider":"email"}', '{}'),
    ('00000000-0000-0000-0000-000000000000', b, 'authenticated', 'authenticated',
     'pos-venda-b@teste.invalid', 'sem-login', now(), now(), now(), '{"provider":"email"}', '{}');

  insert into public.orders (user_id, total_centavos) values (a, 100) returning id into aguardando;
  insert into public.orders (user_id, total_centavos, status) values (a, 100, 'pago') returning id into pago;
  insert into public.orders (user_id, total_centavos, status) values (a, 100, 'em_producao') returning id into producao;
  insert into public.orders (user_id, total_centavos, status) values (a, 100, 'enviado') returning id into enviado;
  insert into public.orders (user_id, total_centavos, status) values (a, 100, 'entregue') returning id into entregue_ontem;
  insert into public.orders (user_id, total_centavos, status) values (a, 100, 'entregue') returning id into entregue_velho;
  insert into public.orders (user_id, total_centavos, status) values (a, 100, 'entregue') returning id into entregue_sem_data;
  insert into public.orders (user_id, total_centavos, status) values (b, 100, 'pago') returning id into pedido_b;

  -- O trigger da trilha registrou "entregue" agora. Ajusta as datas: ontem,
  -- dez dias atras, e nenhuma (pedido antigo, sem registro).
  update public.order_status_history set criado_em = now() - interval '1 day'
   where order_id = entregue_ontem and para = 'entregue';
  update public.order_status_history set criado_em = now() - interval '10 days'
   where order_id = entregue_velho and para = 'entregue';
  delete from public.order_status_history where order_id = entregue_sem_data;

  -- ---------------------------------------------------------------------
  -- Sessao do usuario A
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.solicitacoes_pos_venda (order_id, tipo)
  values (pago, 'cancelamento') returning protocolo into v_protocolo;
  insert into resultado values ('A cancela pedido pago', 'PV-XXXXXXXX', v_protocolo,
    v_protocolo ~ '^PV-[0-9A-F]{8}$');

  insert into public.solicitacoes_pos_venda (order_id, tipo, mensagem)
  values (producao, 'cancelamento', 'mudei de ideia');
  insert into resultado values ('A cancela pedido em producao', 'ok', 'ok', true);

  begin
    insert into public.solicitacoes_pos_venda (order_id, tipo) values (pago, 'cancelamento');
    insert into resultado values ('segunda aberta do mesmo tipo', 'erro 23505', 'passou', false);
  exception when unique_violation then
    insert into resultado values ('segunda aberta do mesmo tipo', 'erro 23505', 'erro 23505', true);
  end;

  begin
    insert into public.solicitacoes_pos_venda (order_id, tipo) values (aguardando, 'cancelamento');
    insert into resultado values ('cancela pedido sem pagamento', 'erro 42501', 'passou', false);
  exception when insufficient_privilege then
    insert into resultado values ('cancela pedido sem pagamento', 'erro 42501', 'erro 42501', true);
  end;

  begin
    insert into public.solicitacoes_pos_venda (order_id, tipo) values (enviado, 'cancelamento');
    insert into resultado values ('cancela pedido enviado', 'erro 42501', 'passou', false);
  exception when insufficient_privilege then
    insert into resultado values ('cancela pedido enviado', 'erro 42501', 'erro 42501', true);
  end;

  begin
    insert into public.solicitacoes_pos_venda (order_id, tipo) values (pedido_b, 'cancelamento');
    insert into resultado values ('A cancela pedido de B', 'erro 42501', 'passou', false);
  exception when insufficient_privilege then
    insert into resultado values ('A cancela pedido de B', 'erro 42501', 'erro 42501', true);
  end;

  begin
    insert into public.solicitacoes_pos_venda (order_id, tipo) values (pago, 'arrependimento');
    insert into resultado values ('desiste antes da entrega', 'erro 42501', 'passou', false);
  exception when insufficient_privilege then
    insert into resultado values ('desiste antes da entrega', 'erro 42501', 'erro 42501', true);
  end;

  insert into public.solicitacoes_pos_venda (order_id, tipo) values (entregue_ontem, 'arrependimento');
  insert into public.solicitacoes_pos_venda (order_id, tipo, mensagem) values (entregue_ontem, 'troca', 'trocar M por G');
  insert into public.solicitacoes_pos_venda (order_id, tipo) values (entregue_velho, 'defeito');
  insert into public.solicitacoes_pos_venda (order_id, tipo) values (entregue_sem_data, 'arrependimento');
  insert into resultado values ('A desiste, troca e relata defeito no prazo', 'ok', 'ok', true);

  begin
    insert into public.solicitacoes_pos_venda (order_id, tipo) values (entregue_velho, 'arrependimento');
    insert into resultado values ('desiste depois de 7 dias', 'erro 42501', 'passou', false);
  exception when insufficient_privilege then
    insert into resultado values ('desiste depois de 7 dias', 'erro 42501', 'erro 42501', true);
  end;

  begin
    insert into public.solicitacoes_pos_venda (order_id, tipo) values (entregue_velho, 'troca');
    insert into resultado values ('troca depois de 7 dias', 'erro 42501', 'passou', false);
  exception when insufficient_privilege then
    insert into resultado values ('troca depois de 7 dias', 'erro 42501', 'erro 42501', true);
  end;

  -- Colunas que a pessoa nao escolhe.
  begin
    insert into public.solicitacoes_pos_venda (order_id, tipo, user_id)
    values (entregue_velho, 'defeito', b);
    insert into resultado values ('A escolhe o dono', 'erro', 'passou', false);
  exception when insufficient_privilege then
    insert into resultado values ('A escolhe o dono', 'erro', 'erro', true);
  end;

  begin
    insert into public.solicitacoes_pos_venda (order_id, tipo, resolvida_em)
    values (producao, 'cancelamento', now());
    insert into resultado values ('A cria ja resolvida', 'erro', 'passou', false);
  exception when insufficient_privilege then
    insert into resultado values ('A cria ja resolvida', 'erro', 'erro', true);
  end;

  begin
    insert into public.solicitacoes_pos_venda (order_id, tipo, protocolo)
    values (entregue_velho, 'defeito', 'PV-ESCOLHIDO');
    insert into resultado values ('A escolhe o protocolo', 'erro', 'passou', false);
  exception when insufficient_privilege then
    insert into resultado values ('A escolhe o protocolo', 'erro', 'erro', true);
  end;

  begin
    insert into public.solicitacoes_pos_venda (order_id, tipo, mensagem)
    values (entregue_ontem, 'defeito', repeat('x', 501));
    insert into resultado values ('mensagem longa demais', 'erro 23514', 'passou', false);
  exception when check_violation then
    insert into resultado values ('mensagem longa demais', 'erro 23514', 'erro 23514', true);
  end;

  select count(*) into n from public.solicitacoes_pos_venda;
  insert into resultado values ('A le as proprias', '6', n::text, n = 6);

  begin
    perform s.user_id from public.solicitacoes_pos_venda s;
    insert into resultado values ('A le user_id', 'erro', 'passou', false);
  exception when insufficient_privilege then
    insert into resultado values ('A le user_id', 'erro', 'erro', true);
  end;

  begin
    update public.solicitacoes_pos_venda set resolvida_em = now() where order_id = pago;
    insert into resultado values ('A encerra a propria', 'erro', 'passou', false);
  exception when insufficient_privilege then
    insert into resultado values ('A encerra a propria', 'erro', 'erro', true);
  end;

  begin
    delete from public.solicitacoes_pos_venda where order_id = pago;
    insert into resultado values ('A apaga a propria', 'erro', 'passou', false);
  exception when insufficient_privilege then
    insert into resultado values ('A apaga a propria', 'erro', 'erro', true);
  end;

  -- ---------------------------------------------------------------------
  -- Sessao do usuario B: nao ve as de A
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', b, 'role', 'authenticated')::text, true);

  select count(*) into n from public.solicitacoes_pos_venda;
  insert into resultado values ('B le as de A', '0', n::text, n = 0);

  reset role;
  perform set_config('request.jwt.claims', null, true);

  -- ---------------------------------------------------------------------
  -- Como postgres: o dono e o default, e o reembolso encerra
  -- ---------------------------------------------------------------------
  select user_id into v_dono from public.solicitacoes_pos_venda where order_id = pago;
  insert into resultado values ('dono vem da sessao', a::text, coalesce(v_dono::text, 'nulo'), v_dono = a);

  update public.orders set status = 'reembolsado' where id = pago;
  select count(*) into n from public.solicitacoes_pos_venda
   where order_id = pago and resolvida_em is not null;
  insert into resultado values ('reembolsar encerra a aberta', '1', n::text, n = 1);

  -- Outra mudanca de status nao encerra nada.
  update public.orders set status = 'enviado' where id = producao;
  select count(*) into n from public.solicitacoes_pos_venda
   where order_id = producao and resolvida_em is null;
  insert into resultado values ('enviar nao encerra', '1', n::text, n = 1);

  delete from public.orders where user_id in (a, b);
  delete from auth.users where id in (a, b);
end;
$$;

select
  case when passou then 'ok' else 'FALHA' end as r,
  caso,
  esperado,
  obtido
from resultado;

commit;
