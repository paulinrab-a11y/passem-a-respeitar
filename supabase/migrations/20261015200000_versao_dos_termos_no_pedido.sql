-- Issue #380 — versao dos termos aceita, gravada no pedido (achado B8).
--
-- O pedido ja guarda QUANDO a pessoa aceitou os termos (#276). Faltava QUAL
-- texto: quando os termos mudarem, um pedido antigo tem que dizer a versao
-- que valia para ele. A versao e `TERMOS_ATUALIZADOS_EM`
-- (lib/loja/termos.ts), a mesma data que /termos mostra.
--
-- Ordem de deploy, e por que a funcao antiga FICA:
--
-- O codigo em producao chama `cria_pedido` com 6 parametros, e o deploy novo
-- esta parado (limite da Vercel). As migrations anteriores trocaram a
-- assinatura com `drop function` + `create function` (#199, #276) — aqui isso
-- derrubaria o checkout de producao no instante em que a migration fosse
-- aplicada, ate o codigo novo subir. Um parametro novo com `default null` no
-- fim tambem nao serve: `create or replace` nao muda a lista de parametros, e
-- uma segunda funcao com default deixaria a chamada de 6 argumentos ambigua.
--
-- Entao: a de 6 parametros continua EXATAMENTE como esta (esta migration nao
-- a toca), e nasce ao lado uma de 7, sem default, que exige a versao. O
-- PostgREST escolhe pelo nome dos argumentos: o codigo antigo manda 6 e cai
-- na antiga; o novo manda `p_termos_versao` e cai na nova. Os pedidos criados
-- pelo codigo antigo entre a migration e o deploy ficam com a versao nula,
-- como os de antes desta issue.
--
-- Depois que o codigo novo estiver no ar, uma migration seguinte apaga a de
-- 6 parametros (`drop function public.cria_pedido(uuid, integer, jsonb,
-- jsonb, jsonb, timestamptz)`), e o teste supabase/tests/cria-pedido.sql
-- volta a exigir uma funcao so.
--
-- O corpo e o da migration 20261015120000, com a versao a mais.

alter table public.orders
  add column termos_versao text
    check (termos_versao is null or char_length(termos_versao) between 1 and 40);

comment on column public.orders.termos_versao is
  'Versao dos termos de compra aceita (TERMOS_ATUALIZADOS_EM). Nula nos pedidos de antes da #380.';

-- Quem le: o dono do pedido, pelo SELECT de `authenticated` na tabela inteira
-- (#18), como `termos_aceitos_em`. Quem escreve: so o service_role.

create function public.cria_pedido(
  p_user_id uuid,
  p_total_centavos integer,
  p_endereco jsonb,
  p_itens jsonb,
  p_frete jsonb,
  p_termos_aceitos_em timestamptz,
  p_termos_versao text
)
returns table (pedido_id uuid, pedido_numero bigint)
language plpgsql
-- INVOKER, como antes: quem chama e o service_role, que ja ignora RLS.
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_numero bigint;
  v_linha record;
  v_pedidas integer;
  v_achadas integer := 0;
  v_variacoes uuid[] := '{}';
  v_quantidades integer[] := '{}';
  v_falta boolean := false;
begin
  if jsonb_array_length(p_itens) = 0 then
    raise exception 'pedido sem itens' using errcode = 'check_violation';
  end if;

  if p_frete ->> 'servico' is null or p_frete ->> 'prazo_dias' is null then
    raise exception 'pedido sem frete' using errcode = 'check_violation';
  end if;

  -- O mesmo para o aceite (#276): a coluna aceita nulo por causa dos pedidos
  -- antigos; pedido novo sem aceite, nao.
  if p_termos_aceitos_em is null then
    raise exception 'pedido sem aceite dos termos' using errcode = 'check_violation';
  end if;

  -- A versao do texto aceito (#380): o mesmo cuidado do aceite. Esta
  -- assinatura so e chamada pelo codigo novo, que sempre manda a versao.
  if p_termos_versao is null then
    raise exception 'pedido sem versao dos termos' using errcode = 'check_violation';
  end if;

  -- Quantas variacoes distintas o pedido pede. O `orcamento` ja junta as
  -- linhas repetidas, mas a soma aqui nao depende disso: duas linhas do mesmo
  -- GG conferem o estoque pela soma, nao uma de cada vez.
  select count(*) into v_pedidas
  from (
    select distinct item ->> 'produto_slug' as slug, nullif(item ->> 'tamanho', '') as tamanho
    from jsonb_array_elements(p_itens) as item
  ) as distintas;

  -- Trava as variacoes antes de ler o estoque. Duas compras da ultima peca ao
  -- mesmo tempo: a segunda espera a primeira terminar e le o numero ja
  -- baixado. A ordem por id e fixa para dois pedidos com os mesmos tamanhos
  -- nunca travarem um ao outro em ordem trocada.
  --
  -- `ativo` de novo aqui: o orcamento leu a vitrine instantes antes, e o dono
  -- pode ter desligado o tamanho nesse meio-tempo.
  for v_linha in
    with pedidas as (
      select
        item ->> 'produto_slug' as slug,
        nullif(item ->> 'tamanho', '') as tamanho,
        sum((item ->> 'quantidade')::integer) as quantidade
      from jsonb_array_elements(p_itens) as item
      group by 1, 2
    )
    select v.id, v.estoque, d.quantidade
    from pedidas d
    join public.produtos p on p.slug = d.slug and p.ativo
    join public.produto_variacoes v
      on v.produto_id = p.id
      and v.tamanho is not distinct from d.tamanho
      and v.ativo
    order by v.id
    for update of v
  loop
    v_achadas := v_achadas + 1;

    if v_linha.estoque is not null then
      -- A falta so e recusada depois do pedido em aberto, abaixo: quando a
      -- ultima peca esta no pedido nao pago da propria pessoa, "pague aquele"
      -- e a resposta que ela pode usar, e "indisponivel" nao.
      v_falta := v_falta or v_linha.estoque < v_linha.quantidade;
      v_variacoes := v_variacoes || v_linha.id;
      v_quantidades := v_quantidades || v_linha.quantidade::integer;
    end if;
  end loop;

  -- SQLSTATE proprio para lib/loja/pedido.ts traduzir sem ler texto. Faltar
  -- uma peca e faltar a variacao inteira respondem igual, como no
  -- `precifica`: dizer qual dos dois contaria o estoque a quem sonda.
  if v_achadas <> v_pedidas then
    raise exception 'produto indisponivel' using errcode = 'ES001';
  end if;

  -- Uma reserva nao paga por pessoa e variacao contada. Sem isto, a mesma
  -- conta prende ate 10 pecas por checkout, 10 checkouts por hora, e o Pix
  -- que expirou vira uma segunda reserva quando a pessoa finaliza de novo em
  -- vez de pagar o pedido que ja tem. Variacao nao contada nao baixa nada,
  -- entao nao prende nada e fica de fora.
  --
  -- Depois das travas acima, e nao antes: uma segunda compra simultanea da
  -- mesma pessoa espera a primeira terminar, e esta consulta (outro comando,
  -- outra leitura) ja enxerga a baixa que ela gravou.
  if exists (
    select 1
    from public.baixas_de_estoque b
    join public.orders o on o.id = b.order_id
    where o.user_id = p_user_id
      and o.status = 'aguardando_pagamento'
      and b.variacao_id = any (v_variacoes)
  ) then
    raise exception 'pedido em aberto' using errcode = 'ES002';
  end if;

  if v_falta then
    raise exception 'produto indisponivel' using errcode = 'ES001';
  end if;

  -- A baixa vem antes do pedido de proposito: as recusas acima nao gastam
  -- numero de pedido. Um `numero` consumido e desfeito vira buraco na lista
  -- do dono.
  update public.produto_variacoes v
  set estoque = v.estoque - b.quantidade
  from unnest(v_variacoes, v_quantidades) as b(variacao_id, quantidade)
  where v.id = b.variacao_id;

  insert into public.orders (
    user_id, total_centavos,
    frete_centavos, frete_servico, frete_prazo_dias,
    entrega_nome, entrega_cep, entrega_logradouro, entrega_numero,
    entrega_complemento, entrega_bairro, entrega_cidade, entrega_uf,
    termos_aceitos_em, termos_versao
  )
  values (
    p_user_id, p_total_centavos,
    (p_frete ->> 'centavos')::integer,
    p_frete ->> 'servico',
    (p_frete ->> 'prazo_dias')::integer,
    p_endereco ->> 'entrega_nome',
    p_endereco ->> 'entrega_cep',
    p_endereco ->> 'entrega_logradouro',
    p_endereco ->> 'entrega_numero',
    nullif(p_endereco ->> 'entrega_complemento', ''),
    p_endereco ->> 'entrega_bairro',
    p_endereco ->> 'entrega_cidade',
    p_endereco ->> 'entrega_uf',
    p_termos_aceitos_em,
    p_termos_versao
  )
  returning orders.id, orders.numero into v_id, v_numero;

  insert into public.order_items (
    order_id, produto_slug, nome, tamanho, quantidade, preco_unitario_centavos
  )
  select
    v_id,
    item ->> 'produto_slug',
    item ->> 'nome',
    nullif(item ->> 'tamanho', ''),
    (item ->> 'quantidade')::integer,
    (item ->> 'preco_unitario_centavos')::integer
  from jsonb_array_elements(p_itens) as item;

  insert into public.baixas_de_estoque (order_id, variacao_id, quantidade)
  select v_id, b.variacao_id, b.quantidade
  from unnest(v_variacoes, v_quantidades) as b(variacao_id, quantidade);

  return query select v_id, v_numero;
end;
$$;

comment on function public.cria_pedido(uuid, integer, jsonb, jsonb, jsonb, timestamptz, text) is
  'Pedido, itens, frete, baixa de estoque, aceite e versao dos termos numa transacao. So service_role executa — ver o revoke abaixo.';

-- A fechadura da #104 para a funcao nova: nasce com EXECUTE para public.
revoke all on function public.cria_pedido(uuid, integer, jsonb, jsonb, jsonb, timestamptz, text)
  from public, anon, authenticated;

grant execute on function public.cria_pedido(uuid, integer, jsonb, jsonb, jsonb, timestamptz, text)
  to service_role;
