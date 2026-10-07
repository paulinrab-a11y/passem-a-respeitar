-- Issue #242 — a fechadura de `conta_pedidos_por_status`.
--
-- A funcao conta a tabela inteira para quem puder chama-la. Como INVOKER, um
-- usuario logado so contaria os proprios pedidos (RLS) — mas o painel e a
-- unica tela que a usa, e endpoint que ninguem precisa nao fica aberto.
--
-- Mesmo formato de muda-status-pedido.sql: a resposta tem que continuar OK
-- daqui a seis meses.

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
where n.nspname = 'public' and p.proname = 'conta_pedidos_por_status';

-- Esperado:
--   seguranca              INVOKER
--   anon_executa           false
--   authenticated_executa  false
--   service_role_executa   true
--   veredito               OK

-- E o indice que o filtro do painel usa existe, com o status na frente:
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and indexname = 'orders_status_criado_em';

-- Esperado: uma linha, com `(status, criado_em DESC, numero DESC)`.
