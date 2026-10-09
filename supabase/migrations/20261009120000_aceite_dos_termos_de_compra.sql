-- Issue #276 — aceite dos termos de compra, gravado no pedido.
--
-- O checkout passa a exigir "Li e aceito os termos de compra". O aceite e
-- conferido no servidor (schema da acao e de `criaPedido`) e carimbado com o
-- relogio do servidor, nunca com uma hora vinda do navegador. Esta migration
-- da a ele um lugar no pedido e faz `cria_pedido` recusar pedido sem aceite.
--
-- A coluna aceita nulo por causa dos pedidos de antes desta migration, que
-- nao tinham a caixinha. `cria_pedido`, nao: pedido novo sem aceite nao
-- nasce, como pedido novo sem frete nao nascia desde a #199.
--
-- Ninguem alem do service_role escreve aqui: `authenticated` so tem SELECT em
-- `orders` (#18), e a coluna nova herda isso. A pessoa le o proprio aceite;
-- nao o muda.

alter table public.orders
  add column termos_aceitos_em timestamptz;

comment on column public.orders.termos_aceitos_em is
  'Quando a pessoa aceitou os termos de compra, pelo relogio do servidor. Nulo nos pedidos de antes da #276.';

-- A assinatura muda (um parametro a mais), entao a antiga sai: `create or
-- replace` com outra lista de parametros criaria uma segunda funcao ao lado
-- da primeira, e a de cinco parametros continuaria criando pedido sem aceite.
-- Mesmo caminho da #199. Migration roda numa transacao: nao ha instante sem
-- `cria_pedido`.
drop function public.cria_pedido(uuid, integer, jsonb, jsonb, jsonb);

create function public.cria_pedido(
  p_user_id uuid,
  p_total_centavos integer,
  p_endereco jsonb,
  p_itens jsonb,
  p_frete jsonb,
  p_termos_aceitos_em timestamptz
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

  -- O mesmo para o aceite (#276): a coluna aceita nulo por causa dos pedidos
  -- antigos; pedido novo sem aceite, nao.
  if p_termos_aceitos_em is null then
    raise exception 'pedido sem aceite dos termos' using errcode = 'check_violation';
  end if;

  insert into public.orders (
    user_id, total_centavos,
    frete_centavos, frete_servico, frete_prazo_dias,
    entrega_nome, entrega_cep, entrega_logradouro, entrega_numero,
    entrega_complemento, entrega_bairro, entrega_cidade, entrega_uf,
    termos_aceitos_em
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
    p_termos_aceitos_em
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
  'Pedido, itens, frete e aceite dos termos numa transacao. So service_role executa — ver o revoke abaixo.';

-- A fechadura da #104, de novo: funcao nova nasce com EXECUTE para public.
-- Sem estas linhas ela seria um endpoint que cria pedido em nome de qualquer
-- um, pelo valor, pelo frete e com o aceite que o chamador escolher.
revoke all on function public.cria_pedido(uuid, integer, jsonb, jsonb, jsonb, timestamptz)
  from public, anon, authenticated;

grant execute on function public.cria_pedido(uuid, integer, jsonb, jsonb, jsonb, timestamptz)
  to service_role;
