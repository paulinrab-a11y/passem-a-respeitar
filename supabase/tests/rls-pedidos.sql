-- Issue #18 — teste de RLS do modelo de pedidos.
--
-- Cria dois usuarios, da um pedido a cada um e ve o que o usuario A alcanca.
-- Limpa o que criou no fim; se algum assert derrubar o bloco, a transacao
-- inteira volta atras e nao sobra nada.
--
-- O ponto que faz o teste valer: `set local role authenticated`. Rodando como
-- postgres a RLS e ignorada e TUDO passa — o teste diria "verde" com o banco
-- escancarado. Todo assert de usuario acontece depois da troca de papel.
--
-- O assert que prova que a troca funcionou e "A lista orders sem filtro": sem
-- where nenhum, tem que voltar 1 e nao 2.
--
-- Como rodar: cole no SQL Editor do Supabase, ou via MCP. Ainda nao roda no
-- CI — falta o runner, que e a Issue #10.

begin;

create temporary table resultado (
  caso text,
  esperado text,
  obtido text,
  passou boolean
) on commit drop;

-- Depois do `set local role authenticated` o papel precisa poder escrever aqui,
-- senao o bloco de teste morre de permissao antes do primeiro assert.
grant all on resultado to authenticated;

do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000aa';
  b uuid := '00000000-0000-0000-0000-0000000000bb';
  pedido_a uuid;
  pedido_b uuid;
  n int;
  erro text;
begin
  -- ---------------------------------------------------------------------
  -- Semente, como postgres
  -- ---------------------------------------------------------------------
  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at,
     raw_app_meta_data, raw_user_meta_data)
  values
    ('00000000-0000-0000-0000-000000000000', a, 'authenticated', 'authenticated',
     'a@teste.invalid', 'sem-login-neste-teste', now(), now(), now(),
     '{"provider":"email"}', '{"nome":"Usuario A"}'),
    ('00000000-0000-0000-0000-000000000000', b, 'authenticated', 'authenticated',
     'b@teste.invalid', 'sem-login-neste-teste', now(), now(), now(),
     '{"provider":"email"}', '{"nome":"Usuario B"}');

  insert into public.orders (user_id, total_centavos) values (a, 12900) returning id into pedido_a;
  insert into public.orders (user_id, total_centavos) values (b, 25800) returning id into pedido_b;

  insert into public.order_items (order_id, produto_slug, nome, tamanho, quantidade, preco_unitario_centavos)
  values (pedido_a, 'camiseta-par', 'Camiseta Passem a Respeitar', 'G', 1, 12900),
         (pedido_b, 'camiseta-par', 'Camiseta Passem a Respeitar', 'M', 2, 12900);

  -- ---------------------------------------------------------------------
  -- Triggers
  -- ---------------------------------------------------------------------
  select count(*) into n from public.profiles where id in (a, b);
  insert into resultado values ('trigger de signup cria profile', '2', n::text, n = 2);

  select count(*) into n from public.order_status_history
   where order_id in (pedido_a, pedido_b) and de is null and para = 'aguardando_pagamento';
  insert into resultado values ('trigger registra status inicial', '2', n::text, n = 2);

  update public.orders set status = 'pago' where id = pedido_a;
  select count(*) into n from public.order_status_history
   where order_id = pedido_a and de = 'aguardando_pagamento' and para = 'pago';
  insert into resultado values ('trigger registra mudanca de status', '1', n::text, n = 1);

  -- user_id e imutavel mesmo aqui, rodando como postgres.
  begin
    update public.orders set user_id = b where id = pedido_a;
    insert into resultado values ('user_id imutavel (postgres)', 'erro', 'passou', false);
  exception when check_violation then
    insert into resultado values ('user_id imutavel (postgres)', 'erro', 'erro', true);
  end;

  -- ---------------------------------------------------------------------
  -- Daqui para baixo: sessao do usuario A
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.orders where id = pedido_a;
  insert into resultado values ('A le o proprio pedido', '1', n::text, n = 1);

  select count(*) into n from public.orders where id = pedido_b;
  insert into resultado values ('A le o pedido de B', '0', n::text, n = 0);

  select count(*) into n from public.orders;
  insert into resultado values ('A lista orders sem filtro', '1', n::text, n = 1);

  select count(*) into n from public.order_items where order_id = pedido_a;
  insert into resultado values ('A le item do proprio pedido', '1', n::text, n = 1);

  select count(*) into n from public.order_items where order_id = pedido_b;
  insert into resultado values ('A le item do pedido de B', '0', n::text, n = 0);

  select count(*) into n from public.order_status_history where order_id = pedido_a;
  insert into resultado values ('A le historico do proprio pedido', '2', n::text, n = 2);

  select count(*) into n from public.order_status_history where order_id = pedido_b;
  insert into resultado values ('A le historico do pedido de B', '0', n::text, n = 0);

  select count(*) into n from public.profiles where id = b;
  insert into resultado values ('A le profile de B', '0', n::text, n = 0);

  select count(*) into n from public.profiles where id = a;
  insert into resultado values ('A le o proprio profile', '1', n::text, n = 1);

  -- O PostgREST publica o schema public em /rest/v1/rpc. Funcao de trigger
  -- SECURITY DEFINER chamavel por ai foi achado do advisor, corrigido na
  -- migration 20260923123000. 42501 = sem privilegio.
  begin
    perform public.cria_profile_no_signup();
    insert into resultado values ('A chama a funcao de trigger por RPC', 'erro', 'passou', false);
  exception when others then
    get stacked diagnostics erro = returned_sqlstate;
    insert into resultado values ('A chama a funcao de trigger por RPC', 'erro', 'sqlstate ' || erro, erro = '42501');
  end;

  -- ---------------------------------------------------------------------
  -- Escrita em pedido: o GRANT barra antes da RLS entrar na conversa
  -- ---------------------------------------------------------------------
  begin
    insert into public.orders (user_id, total_centavos) values (a, 1);
    insert into resultado values ('A insere pedido', 'erro', 'passou', false);
  exception
    when insufficient_privilege then
      insert into resultado values ('A insere pedido', 'erro', 'sem privilegio', true);
    when others then
      get stacked diagnostics erro = returned_sqlstate;
      insert into resultado values ('A insere pedido', 'erro', erro, true);
  end;

  begin
    update public.orders set status = 'entregue' where id = pedido_a;
    insert into resultado values ('A muda status do proprio pedido', 'erro', 'passou', false);
  exception
    when insufficient_privilege then
      insert into resultado values ('A muda status do proprio pedido', 'erro', 'sem privilegio', true);
    when others then
      get stacked diagnostics erro = returned_sqlstate;
      insert into resultado values ('A muda status do proprio pedido', 'erro', erro, true);
  end;

  begin
    update public.orders set total_centavos = 1 where id = pedido_a;
    insert into resultado values ('A muda preco do proprio pedido', 'erro', 'passou', false);
  exception
    when insufficient_privilege then
      insert into resultado values ('A muda preco do proprio pedido', 'erro', 'sem privilegio', true);
    when others then
      get stacked diagnostics erro = returned_sqlstate;
      insert into resultado values ('A muda preco do proprio pedido', 'erro', erro, true);
  end;

  begin
    delete from public.orders where id = pedido_a;
    insert into resultado values ('A apaga o proprio pedido', 'erro', 'passou', false);
  exception
    when insufficient_privilege then
      insert into resultado values ('A apaga o proprio pedido', 'erro', 'sem privilegio', true);
    when others then
      get stacked diagnostics erro = returned_sqlstate;
      insert into resultado values ('A apaga o proprio pedido', 'erro', erro, true);
  end;

  begin
    insert into public.order_items (order_id, produto_slug, nome, quantidade, preco_unitario_centavos)
    values (pedido_a, 'brinde', 'Brinde', 1, 0);
    insert into resultado values ('A insere item no proprio pedido', 'erro', 'passou', false);
  exception
    when insufficient_privilege then
      insert into resultado values ('A insere item no proprio pedido', 'erro', 'sem privilegio', true);
    when others then
      get stacked diagnostics erro = returned_sqlstate;
      insert into resultado values ('A insere item no proprio pedido', 'erro', erro, true);
  end;

  -- ---------------------------------------------------------------------
  -- Mass assignment: nome pode, id nao. Quem barra e o GRANT por coluna.
  -- ---------------------------------------------------------------------
  update public.profiles set nome = 'Usuario A editado' where id = a;
  select count(*) into n from public.profiles where id = a and nome = 'Usuario A editado';
  insert into resultado values ('A edita o proprio nome', '1', n::text, n = 1);

  begin
    update public.profiles set id = b where id = a;
    insert into resultado values ('A troca o id do proprio profile', 'erro', 'passou', false);
  exception
    when insufficient_privilege then
      insert into resultado values ('A troca o id do proprio profile', 'erro', 'sem privilegio', true);
    when others then
      get stacked diagnostics erro = returned_sqlstate;
      insert into resultado values ('A troca o id do proprio profile', 'erro', erro, true);
  end;

  -- Editar o perfil de B: a policy deixa 0 linhas visiveis, entao o update
  -- acerta nada. Nao da erro — e por isso que so a RLS nunca basta.
  update public.profiles set nome = 'invadido' where id = b;
  get diagnostics n = row_count;
  insert into resultado values ('A edita profile de B', '0 linhas', n::text || ' linhas', n = 0);

  -- ---------------------------------------------------------------------
  -- Limpeza
  -- ---------------------------------------------------------------------
  reset role;
  perform set_config('request.jwt.claims', null, true);

  -- orders antes de auth.users: o on delete restrict impede a ordem inversa,
  -- de proposito (pedido nao some porque o dono apagou a conta).
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

select
  count(*) filter (where passou) as passou,
  count(*) filter (where not passou) as falhou
from resultado;

commit;
