-- Issue #104 — a fechadura de `cria_pedido`.
--
-- Esta funcao recebe `p_user_id` e `p_total_centavos` como parametro: quem
-- puder chama-la escolhe de quem e o pedido e quanto ele custa. O padrao do
-- Supabase concede EXECUTE a `public` em funcao nova no schema `public`, entao
-- sem o revoke da migration ela seria um endpoint aberto em /rest/v1/rpc.
--
-- Este arquivo existe para a resposta continuar `false` daqui a seis meses.

select
  p.proname,
  case when p.prosecdef then 'DEFINER' else 'INVOKER' end as seguranca,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_executa,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_executa,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_executa,
  case
    when has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'FALHOU'
    when not has_function_privilege('service_role', p.oid, 'EXECUTE') then 'FALHOU'
    when p.prosecdef then 'FALHOU'
    else 'OK'
  end as veredito
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'cria_pedido';

-- Esperado:
--   seguranca              INVOKER
--   anon_executa           false
--   authenticated_executa  false
--   service_role_executa   true
--   veredito               OK

-- ---------------------------------------------------------------------------
-- Issue #296 — estoque.
--
-- Roda dentro de uma transacao desfeita no fim: usuario, produto e pedidos de
-- teste nao sobram. Cole no SQL Editor do banco LOCAL (`npm run e2e:banco`),
-- nunca no de producao.
-- ---------------------------------------------------------------------------

begin;

create temporary table r (caso text, esperado text, obtido text, passou boolean) on commit drop;

-- O registro da baixa nao sai para o cliente: saber que um tamanho tem baixa
-- e saber que ele tem estoque contado.
insert into r
select 'cliente nao le baixas_de_estoque', 'false', aberto::text, not aberto
from (
  select has_table_privilege('anon', 'public.baixas_de_estoque', 'SELECT')
    or has_table_privilege('authenticated', 'public.baixas_de_estoque', 'SELECT') as aberto
) as t;

insert into r
select 'devolve_estoque fora do rpc', 'false', aberto::text, not aberto
from (
  select has_function_privilege('anon', 'public.devolve_estoque()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.devolve_estoque()', 'EXECUTE') as aberto
) as t;

do $$
declare
  quem uuid := '00000000-0000-0000-0000-00000000e57e';
  produto uuid;
  endereco jsonb := '{"entrega_nome":"Teste Estoque","entrega_cep":"01310100","entrega_logradouro":"Avenida Paulista","entrega_numero":"1578","entrega_bairro":"Bela Vista","entrega_cidade":"Sao Paulo","entrega_uf":"SP"}';
  frete jsonb := '{"centavos":2350,"servico":"sedex","prazo_dias":3}';
  pedido uuid;
  numero_a bigint;
  numero_b bigint;
  n int;
  e int;
begin
  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
     confirmation_token, recovery_token, email_change_token_new,
     email_change_token_current, email_change, phone_change,
     phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', quem, 'authenticated', 'authenticated',
    'estoque-teste@exemplo.invalid', 'sem-login-neste-teste', now(), now(), now(),
    '{}', '{}', '', '', '', '', '', '', '', '');

  insert into public.produtos (slug, nome) values ('teste-estoque', 'Teste de estoque')
  returning id into produto;

  -- P acabou, M tem duas, G nao e contado, GG tem uma, XGG esta desligado.
  insert into public.produto_variacoes (produto_id, tamanho, preco_centavos, estoque, ativo, ordem)
  values
    (produto, 'P', 12000, 0, true, 1),
    (produto, 'M', 12000, 2, true, 2),
    (produto, 'G', 12000, null, true, 3),
    (produto, 'GG', 12000, 1, true, 4),
    (produto, 'XGG', 12000, null, false, 5);

  -- Estoque zero recusa, com o SQLSTATE que lib/loja/pedido.ts traduz.
  begin
    perform public.cria_pedido(quem, 14350, endereco,
      '[{"produto_slug":"teste-estoque","nome":"Teste","tamanho":"P","quantidade":1,"preco_unitario_centavos":12000}]',
      frete);
    insert into r values ('estoque 0 recusa', 'ES001', 'criou', false);
  exception when sqlstate 'ES001' then
    insert into r values ('estoque 0 recusa', 'ES001', 'ES001', true);
  end;

  select count(*) into n from public.orders where user_id = quem;
  insert into r values ('recusa nao deixa pedido', '0', n::text, n = 0);

  -- Estoque 2, quantidade 1: fica 1, e a baixa fica registrada.
  select c.pedido_id into pedido from public.cria_pedido(quem, 14350, endereco,
    '[{"produto_slug":"teste-estoque","nome":"Teste","tamanho":"M","quantidade":1,"preco_unitario_centavos":12000}]',
    frete) as c;

  select estoque into e from public.produto_variacoes where produto_id = produto and tamanho = 'M';
  insert into r values ('estoque 2 com 1 pedida fica 1', '1', e::text, e = 1);

  select quantidade into n from public.baixas_de_estoque where order_id = pedido;
  insert into r values ('baixa registrada', '1', coalesce(n::text, 'nada'), coalesce(n = 1, false));

  -- Nao controlado: nada muda e nada e registrado.
  perform public.cria_pedido(quem, 38350, endereco,
    '[{"produto_slug":"teste-estoque","nome":"Teste","tamanho":"G","quantidade":3,"preco_unitario_centavos":12000}]',
    frete);
  select count(*) into n from public.produto_variacoes
  where produto_id = produto and tamanho = 'G' and estoque is null;
  insert into r values ('estoque nulo continua nulo', '1', n::text, n = 1);

  select count(*) into n from public.baixas_de_estoque b
  join public.produto_variacoes v on v.id = b.variacao_id
  where v.produto_id = produto and v.tamanho = 'G';
  insert into r values ('nulo nao registra baixa', '0', n::text, n = 0);

  -- Duas linhas do mesmo GG somam: uma de cada vez caberia, juntas nao.
  begin
    perform public.cria_pedido(quem, 26350, endereco,
      '[{"produto_slug":"teste-estoque","nome":"Teste","tamanho":"GG","quantidade":1,"preco_unitario_centavos":12000},
        {"produto_slug":"teste-estoque","nome":"Teste","tamanho":"GG","quantidade":1,"preco_unitario_centavos":12000}]',
      frete);
    insert into r values ('linhas repetidas somam', 'ES001', 'criou', false);
  exception when sqlstate 'ES001' then
    insert into r values ('linhas repetidas somam', 'ES001', 'ES001', true);
  end;

  select estoque into e from public.produto_variacoes where produto_id = produto and tamanho = 'GG';
  insert into r values ('recusa nao baixa nada', '1', e::text, e = 1);

  -- Desligado entre o orcamento e a gravacao: mesma resposta.
  begin
    perform public.cria_pedido(quem, 14350, endereco,
      '[{"produto_slug":"teste-estoque","nome":"Teste","tamanho":"XGG","quantidade":1,"preco_unitario_centavos":12000}]',
      frete);
    insert into r values ('variacao desligada recusa', 'ES001', 'criou', false);
  exception when sqlstate 'ES001' then
    insert into r values ('variacao desligada recusa', 'ES001', 'ES001', true);
  end;

  -- A recusa vem antes do insert em `orders`: nao gasta numero de pedido.
  select c.pedido_numero into numero_a from public.cria_pedido(quem, 14350, endereco,
    '[{"produto_slug":"teste-estoque","nome":"Teste","tamanho":"G","quantidade":1,"preco_unitario_centavos":12000}]',
    frete) as c;
  begin
    perform public.cria_pedido(quem, 14350, endereco,
      '[{"produto_slug":"teste-estoque","nome":"Teste","tamanho":"P","quantidade":1,"preco_unitario_centavos":12000}]',
      frete);
  exception when sqlstate 'ES001' then null;
  end;
  select c.pedido_numero into numero_b from public.cria_pedido(quem, 14350, endereco,
    '[{"produto_slug":"teste-estoque","nome":"Teste","tamanho":"G","quantidade":1,"preco_unitario_centavos":12000}]',
    frete) as c;
  insert into r values ('recusa nao gasta numero', (numero_a + 1)::text, numero_b::text,
    numero_b = numero_a + 1);

  -- Cancelar antes de pagar devolve, e a baixa some.
  update public.orders set status = 'cancelado' where id = pedido;

  select estoque into e from public.produto_variacoes where produto_id = produto and tamanho = 'M';
  insert into r values ('cancelar devolve', '2', e::text, e = 2);

  select count(*) into n from public.baixas_de_estoque where order_id = pedido;
  insert into r values ('baixa devolvida some', '0', n::text, n = 0);

  -- Pago, enviado e reembolsado: a peca saiu da loja, nao volta.
  select c.pedido_id into pedido from public.cria_pedido(quem, 26350, endereco,
    '[{"produto_slug":"teste-estoque","nome":"Teste","tamanho":"M","quantidade":2,"preco_unitario_centavos":12000}]',
    frete) as c;
  update public.orders set status = 'pago' where id = pedido;
  update public.orders set status = 'enviado' where id = pedido;
  update public.orders set status = 'reembolsado' where id = pedido;

  select estoque into e from public.produto_variacoes where produto_id = produto and tamanho = 'M';
  insert into r values ('reembolso depois do envio nao devolve', '0', e::text, e = 0);

  -- Pago e reembolsado antes do envio: devolve.
  update public.produto_variacoes set estoque = 1 where produto_id = produto and tamanho = 'M';
  select c.pedido_id into pedido from public.cria_pedido(quem, 14350, endereco,
    '[{"produto_slug":"teste-estoque","nome":"Teste","tamanho":"M","quantidade":1,"preco_unitario_centavos":12000}]',
    frete) as c;
  update public.orders set status = 'pago' where id = pedido;
  update public.orders set status = 'reembolsado' where id = pedido;

  select estoque into e from public.produto_variacoes where produto_id = produto and tamanho = 'M';
  insert into r values ('reembolso antes do envio devolve', '1', e::text, e = 1);

  -- Pedido sem baixa (de antes da #296) cancelado: nao inventa peca.
  insert into public.orders (user_id, total_centavos) values (quem, 12000) returning id into pedido;
  insert into public.order_items
    (order_id, produto_slug, nome, tamanho, quantidade, preco_unitario_centavos)
  values (pedido, 'teste-estoque', 'Teste', 'M', 1, 12000);
  update public.orders set status = 'cancelado' where id = pedido;

  select estoque into e from public.produto_variacoes where produto_id = produto and tamanho = 'M';
  insert into r values ('pedido antigo nao devolve', '1', e::text, e = 1);
end;
$$;

select case when passou then 'ok' else 'FALHA' end as res, caso, esperado, obtido from r;
select count(*) filter (where passou) as passou, count(*) filter (where not passou) as falhou from r;

-- Desfeito, nao confirmado.
rollback;

-- Esperado: todas as linhas `ok`, e `falhou` = 0.
