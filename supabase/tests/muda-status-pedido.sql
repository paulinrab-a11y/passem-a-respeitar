-- Issue #43 — a fechadura de `muda_status_pedido`.
--
-- A funcao recebe `p_autor` e `p_order_id` como parametro: quem puder
-- chama-la muda o status do pedido de qualquer um e assina como quem quiser.
-- O padrao do Supabase concede EXECUTE a `public` em funcao nova, entao sem
-- o revoke da migration ela seria um endpoint aberto em /rest/v1/rpc.
--
-- Mesmo formato de cria-pedido.sql: a resposta tem que continuar OK daqui a
-- seis meses.

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
where n.nspname = 'public' and p.proname = 'muda_status_pedido';

-- Esperado:
--   seguranca              INVOKER
--   anon_executa           false
--   authenticated_executa  false
--   service_role_executa   true
--   veredito               OK

-- E a trilha continua DEFINER (ela precisa escrever numa tabela em que o
-- usuario nao tem INSERT), agora lendo autor e motivo da configuracao:
select
  p.proname,
  case when p.prosecdef then 'DEFINER' else 'INVOKER' end as seguranca,
  position('app.autor' in pg_get_functiondef(p.oid)) > 0 as le_autor_da_config,
  position('app.motivo' in pg_get_functiondef(p.oid)) > 0 as le_motivo_da_config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'registra_status_pedido';

-- Esperado:
--   seguranca              DEFINER
--   le_autor_da_config     true
--   le_motivo_da_config    true
