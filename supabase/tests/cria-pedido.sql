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
