-- Issue #18 — fecha o EXECUTE das funcoes.
--
-- Achado do `get_advisors` logo depois da migration anterior: o Postgres
-- concede EXECUTE a PUBLIC em toda funcao nova, e o PostgREST expoe o schema
-- public inteiro em /rest/v1/rpc. As duas funcoes de trigger sao SECURITY
-- DEFINER — ficavam chamaveis por qualquer visitante, sem login.
--
-- Trigger nao precisa desse privilegio: o Postgres nao checa EXECUTE ao
-- disparar trigger. Revogar nao quebra nada, e o teste de RLS confirma.

revoke all on function public.cria_profile_no_signup() from public, anon, authenticated;
revoke all on function public.registra_status_pedido() from public, anon, authenticated;
revoke all on function public.toca_atualizado_em() from public, anon, authenticated;
revoke all on function public.pedido_dono_imutavel() from public, anon, authenticated;

-- Esta e a excecao: `pedido_e_meu` e usada dentro da policy de order_items e
-- order_status_history, e policy roda com o papel de quem consulta. Sem EXECUTE
-- para authenticated, ler o proprio pedido daria erro de permissao.
--
-- E seguro porque e SECURITY INVOKER: quem chamar direto pelo RPC so descobre
-- se um pedido e dele, que e exatamente o que ele ja pode ver.
revoke all on function public.pedido_e_meu(uuid) from public, anon;
grant execute on function public.pedido_e_meu(uuid) to authenticated;
