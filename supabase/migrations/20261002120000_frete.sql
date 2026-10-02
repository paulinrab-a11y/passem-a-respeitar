-- Issue #199 — frete pelo CEP, com Melhor Envio.
--
-- Tres mudancas, e nenhuma delas toca em preco de produto:
--
--   1. O produto ganha peso e medidas da peca embalada. E o que o calculo de
--      frete pede. Nulos ate o dono informar: produto sem medida nao tem frete,
--      e sem frete o pedido nao e criado. Frete zero por falta de dado nao
--      existe.
--
--   2. O pedido guarda o frete que foi cobrado, por qual servico, e o prazo de
--      transporte cotado. O servico e o que o dono le para saber qual postagem
--      comprar; o valor e registro do que entrou no total.
--
--   3. `cria_pedido` passa a receber o frete. A fechadura da #104 vale igual:
--      so service_role executa.

-- ---------------------------------------------------------------------------
-- 1. Peso e medidas do produto
-- ---------------------------------------------------------------------------

alter table public.produtos
  add column peso_gramas integer check (peso_gramas between 1 and 30000),
  add column altura_cm integer check (altura_cm between 1 and 100),
  add column largura_cm integer check (largura_cm between 1 and 100),
  add column comprimento_cm integer check (comprimento_cm between 1 and 100);

comment on column public.produtos.peso_gramas is
  'Uma unidade embalada, em gramas. Nulo: sem frete, e sem frete nao ha pedido.';
comment on column public.produtos.altura_cm is 'Uma unidade embalada, em cm.';
comment on column public.produtos.largura_cm is 'Uma unidade embalada, em cm.';
comment on column public.produtos.comprimento_cm is 'Uma unidade embalada, em cm.';

-- Leitura publica, como o nome e a descricao: e informacao do produto, e e o
-- client da sessao que calcula o orcamento. Escrita continua sem ninguem alem
-- do service_role.
grant select (peso_gramas, altura_cm, largura_cm, comprimento_cm)
  on public.produtos to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. O frete no pedido
-- ---------------------------------------------------------------------------

alter table public.orders
  add column frete_centavos integer not null default 0 check (frete_centavos >= 0),
  add column frete_servico text check (frete_servico in ('pac', 'sedex')),
  add column frete_prazo_dias integer check (frete_prazo_dias between 1 and 120),
  -- Os dois andam juntos: servico sem prazo, ou prazo sem servico, e cotacao
  -- pela metade. Pedido de antes desta migration fica com os dois nulos.
  add constraint orders_frete_completo check (
    (frete_servico is null) = (frete_prazo_dias is null)
  ),
  -- O frete esta dentro do total. Total menor que o frete seria produto com
  -- preco negativo.
  add constraint orders_frete_cabe_no_total check (frete_centavos <= total_centavos);

comment on column public.orders.frete_centavos is
  'Frete cobrado, ja somado em total_centavos. Zero nos pedidos de antes da #199.';
comment on column public.orders.frete_servico is
  'pac ou sedex: a postagem que o dono compra. Nulo nos pedidos de antes da #199.';
comment on column public.orders.frete_prazo_dias is
  'Prazo de transporte cotado, em dias uteis, contado depois da producao.';

-- ---------------------------------------------------------------------------
-- 3. cria_pedido com frete
-- ---------------------------------------------------------------------------

-- A assinatura muda, entao a antiga sai. Ficar com as duas seria deixar um
-- caminho que cria pedido sem frete.
drop function public.cria_pedido(uuid, integer, jsonb, jsonb);

create function public.cria_pedido(
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
begin
  if jsonb_array_length(p_itens) = 0 then
    raise exception 'pedido sem itens' using errcode = 'check_violation';
  end if;

  -- Pedido novo sempre tem frete cotado. Os checks da tabela aceitam nulo por
  -- causa dos pedidos antigos; esta funcao, nao.
  if p_frete ->> 'servico' is null or p_frete ->> 'prazo_dias' is null then
    raise exception 'pedido sem frete' using errcode = 'check_violation';
  end if;

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

  return query select v_id, v_numero;
end;
$$;

comment on function public.cria_pedido is
  'Pedido, itens e frete numa transacao. So service_role executa — ver o revoke abaixo.';

-- A fechadura da #104. Sem estas linhas a funcao e um endpoint publico que
-- cria pedido em nome de qualquer um, pelo valor e pelo frete que o chamador
-- escolher.
revoke all on function public.cria_pedido(uuid, integer, jsonb, jsonb, jsonb)
  from public, anon, authenticated;

grant execute on function public.cria_pedido(uuid, integer, jsonb, jsonb, jsonb)
  to service_role;
