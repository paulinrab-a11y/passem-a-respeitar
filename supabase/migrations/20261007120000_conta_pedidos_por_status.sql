-- Issue #242 — contadores do painel de pedidos e indice do filtro por status.
--
-- O painel do dono passa a filtrar por status e a mostrar quantos pedidos ha
-- em cada um. Os numeros vem de UMA consulta: contar com um `count` por
-- filtro seriam nove idas ao banco para desenhar nove numeros, e o PostgREST
-- do Supabase nao expoe `count()` agregado por padrao.
--
-- A funcao e INVOKER, como `muda_status_pedido` e `cria_pedido`: quem chama e
-- o service_role da rota administrativa, que ja enxerga `orders` inteira.
-- Chamada por `authenticated`, contaria so os pedidos da propria pessoa (RLS)
-- — inofensivo, mas o EXECUTE e revogado mesmo assim: funcao que so o painel
-- usa nao precisa estar em /rest/v1/rpc para todo mundo.

create or replace function public.conta_pedidos_por_status()
returns table (status public.status_pedido, total bigint)
language sql
security invoker
stable
set search_path = ''
as $$
  select o.status, count(*)
  from public.orders o
  group by o.status;
$$;

comment on function public.conta_pedidos_por_status() is
  'Quantos pedidos ha em cada status, para os contadores do painel do dono. So service_role executa — ver o revoke abaixo.';

-- O Supabase concede EXECUTE a public em funcao nova.
revoke all on function public.conta_pedidos_por_status() from public, anon, authenticated;
grant execute on function public.conta_pedidos_por_status() to service_role;

-- A lista filtrada le `where status in (...) order by criado_em desc, numero
-- desc`. Ate aqui o unico indice de `orders` era por dono (`user_id,
-- criado_em`), que o painel nao usa: sem este, cada pagina do filtro
-- percorreria a tabela inteira. A contagem acima tambem se serve dele.
create index orders_status_criado_em
  on public.orders (status, criado_em desc, numero desc);
