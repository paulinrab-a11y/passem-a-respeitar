-- Issue #296 — estoque zero bloqueia a venda.
--
-- `produto_variacoes.estoque` existe desde a #99 com a regra escrita no
-- comentario: null nao controla, zero bloqueia. Ninguem lia a coluna, entao o
-- dono zerava o GG esperando parar a venda e o checkout seguia vendendo.
--
-- Tres mudancas:
--
--   1. `baixas_de_estoque`: o que cada pedido tirou do estoque. Existe para a
--      devolucao saber exatamente quanto devolver, e para pedido de antes
--      desta migration (que nao baixou nada) nao devolver nada.
--
--   2. `cria_pedido` confere e da baixa na mesma transacao em que grava o
--      pedido. A baixa e na criacao, e nao no pagamento: no pagamento, duas
--      pessoas pagariam a ultima peca e uma delas viraria estorno.
--
--   3. Cancelar ou reembolsar antes do envio devolve a baixa. Sem isto, todo
--      Pix abandonado que o dono cancela comeria uma peca para sempre.
--
-- Pedido em `aguardando_pagamento` segura a peca ate alguem cancela-lo, e
-- nada cancela sozinho ainda (#298). Por isso `cria_pedido` tambem recusa um
-- segundo pedido nao pago da mesma pessoa na mesma variacao contada.

-- ---------------------------------------------------------------------------
-- 1. A baixa de cada pedido
-- ---------------------------------------------------------------------------

create table public.baixas_de_estoque (
  order_id uuid not null references public.orders (id) on delete cascade,
  variacao_id uuid not null references public.produto_variacoes (id) on delete cascade,
  quantidade integer not null check (quantidade > 0),
  criado_em timestamptz not null default now(),
  primary key (order_id, variacao_id)
);

comment on table public.baixas_de_estoque is
  'Quanto cada pedido tirou do estoque. So variacao com estoque controlado entra aqui. Cancelar ou reembolsar antes do envio devolve e apaga a linha.';

-- A FK de variacao sem indice faria todo delete de variacao varrer a tabela.
create index baixas_de_estoque_variacao on public.baixas_de_estoque (variacao_id);

-- Nenhum acesso do cliente. Saber que um tamanho tem baixa e saber que ele tem
-- estoque contado, e quantas pecas restam e informacao do negocio (#99).
revoke all on public.baixas_de_estoque from anon, authenticated;
alter table public.baixas_de_estoque enable row level security;

-- ---------------------------------------------------------------------------
-- 2. cria_pedido com estoque
-- ---------------------------------------------------------------------------

-- Mesma assinatura da #199: `create or replace` troca o corpo e mantem os
-- privilegios. O revoke do fim e repetido assim mesmo — e a fechadura, e
-- quem ler so este arquivo tem que ve-la.
create or replace function public.cria_pedido(
  p_user_id uuid,
  p_total_centavos integer,
  p_endereco jsonb,
  p_itens jsonb,
  p_frete jsonb
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
    entrega_complemento, entrega_bairro, entrega_cidade, entrega_uf
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
    p_endereco ->> 'entrega_uf'
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

comment on function public.cria_pedido is
  'Pedido, itens, frete e baixa de estoque numa transacao. So service_role executa — ver o revoke abaixo.';

-- A fechadura da #104. Sem estas linhas a funcao e um endpoint publico que
-- cria pedido em nome de qualquer um, pelo valor que o chamador escolher — e
-- agora tambem zera o estoque de quem quiser.
revoke all on function public.cria_pedido(uuid, integer, jsonb, jsonb, jsonb)
  from public, anon, authenticated;

grant execute on function public.cria_pedido(uuid, integer, jsonb, jsonb, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Devolucao no cancelamento
-- ---------------------------------------------------------------------------

-- Trigger e nao codigo em `muda_status_pedido`: cancelamento feito na mao no
-- painel do Supabase tambem devolve. Mesma razao da trilha da #18.
--
-- INVOKER: quem muda status de pedido e o service_role ou o dono no painel,
-- e os dois ja escrevem nas duas tabelas. `authenticated` nem tem UPDATE em
-- `orders`, entao nao ha caminho do cliente ate aqui.
create or replace function public.devolve_estoque()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Apaga e devolve no mesmo comando: a linha some junto com a devolucao, e
  -- um segundo disparo para o mesmo pedido nao acha o que devolver de novo.
  --
  -- Variacao que passou a nao controlar estoque (null) depois da baixa fica
  -- null: somar a nulo continuaria nulo, e o filtro deixa isso explicito.
  with devolvidas as (
    delete from public.baixas_de_estoque b
    where b.order_id = new.id
    returning b.variacao_id, b.quantidade
  )
  update public.produto_variacoes v
  set estoque = v.estoque + d.quantidade
  from devolvidas d
  where v.id = d.variacao_id
    and v.estoque is not null;

  return null;
end;
$$;

-- So antes do envio. Depois de `enviado` a peca saiu da loja: um reembolso de
-- pedido entregue nao a traz de volta para a prateleira.
create trigger orders_devolve_estoque
  after update of status on public.orders
  for each row
  when (
    new.status in ('cancelado', 'reembolsado')
    and old.status in ('aguardando_pagamento', 'pago', 'em_producao')
  )
  execute function public.devolve_estoque();

-- Trigger nao precisa de EXECUTE para disparar (#18). Fechado como as outras.
revoke all on function public.devolve_estoque() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. A coluna diz onde a regra mora
-- ---------------------------------------------------------------------------

comment on column public.produto_variacoes.estoque is
  'Pecas que ainda podem ser vendidas. null = nao controlado. cria_pedido recusa quando falta e da a baixa ao criar o pedido; cancelar ou reembolsar antes do envio devolve (baixas_de_estoque). Pedido aguardando pagamento segura a peca ate ser cancelado: nada cancela sozinho ainda (#298), e cada pessoa tem no maximo um pedido nao pago por variacao contada. Para tirar um tamanho da vitrine, ativo = false: estoque zero recusa no fim do checkout, mas a vitrine continua mostrando o tamanho.';
