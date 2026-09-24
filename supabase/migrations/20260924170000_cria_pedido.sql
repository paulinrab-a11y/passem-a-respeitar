-- Issue #104 — criacao do pedido numa transacao so.
--
-- Por que uma funcao no banco em vez de dois `insert` seguidos pelo client
-- admin: pedido e itens tem que entrar juntos. Dois inserts com uma falha no
-- meio deixam pedido sem item — estado que a tela de detalhe ate sabe mostrar
-- (#42), mas que nao deveria existir. Corpo de funcao roda em uma transacao.
--
-- ATENCAO, e o ponto mais delicado deste arquivo:
--
--   Esta funcao recebe `p_user_id` e `p_total_centavos` como PARAMETRO. Quem
--   puder chama-la escolhe de quem e o pedido e quanto ele custa.
--
--   O padrao do Supabase concede EXECUTE a `public` em funcao nova no schema
--   `public`. Sem o revoke do fim deste arquivo, `authenticated` chamaria
--   /rest/v1/rpc/cria_pedido e criaria pedido de graca em nome de outra pessoa.
--
--   Ja aconteceu neste projeto, com as funcoes de trigger da #18, e quem pegou
--   foi o advisor. O revoke abaixo nao e formalidade, e a fechadura.

create or replace function public.cria_pedido(
  p_user_id uuid,
  p_total_centavos integer,
  p_endereco jsonb,
  p_itens jsonb
)
returns table (pedido_id uuid, pedido_numero bigint)
language plpgsql
-- INVOKER de proposito: quem chama e o service_role, que ja ignora RLS. Marcar
-- DEFINER nao daria poder nenhum a mais e criaria uma funcao privilegiada onde
-- nao precisa existir uma.
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

  insert into public.orders (
    user_id, total_centavos,
    entrega_nome, entrega_cep, entrega_logradouro, entrega_numero,
    entrega_complemento, entrega_bairro, entrega_cidade, entrega_uf
  )
  values (
    p_user_id, p_total_centavos,
    p_endereco ->> 'entrega_nome',
    p_endereco ->> 'entrega_cep',
    p_endereco ->> 'entrega_logradouro',
    p_endereco ->> 'entrega_numero',
    -- `nullif`: string vazia no banco seria um terceiro estado sem significado.
    nullif(p_endereco ->> 'entrega_complemento', ''),
    p_endereco ->> 'entrega_bairro',
    p_endereco ->> 'entrega_cidade',
    p_endereco ->> 'entrega_uf'
  )
  returning orders.id, orders.numero into v_id, v_numero;

  -- O snapshot da #18. O que entra aqui e copia do catalogo no momento da
  -- compra, e nunca mais muda — preco novo no catalogo nao mexe em pedido
  -- antigo.
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
  'Pedido e itens numa transacao. So service_role executa — ver o revoke abaixo.';

-- A fechadura. Sem estas duas linhas a funcao e um endpoint publico que cria
-- pedido em nome de qualquer um, pelo valor que o chamador escolher.
revoke all on function public.cria_pedido(uuid, integer, jsonb, jsonb)
  from public, anon, authenticated;

grant execute on function public.cria_pedido(uuid, integer, jsonb, jsonb)
  to service_role;
