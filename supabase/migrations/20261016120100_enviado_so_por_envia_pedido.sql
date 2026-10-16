-- Issue #391 — `enviado` sai de `muda_status_pedido` (limpeza da #378).
--
-- A migration 20261015180000 criou `envia_pedido`, que grava status e codigo
-- de rastreio no mesmo UPDATE, e deixou `muda_status_pedido` aceitando
-- `enviado` sem codigo ate o deploy, porque o painel que estava em producao
-- marcava enviado por ela. O codigo novo esta no ar:
-- app/conta/admin/pedidos/acoes.ts manda todo `enviado` para `envia_pedido`,
-- e sem codigo nem chega ao banco.
--
-- Agora o unico caminho para `enviado` e `envia_pedido`. Aqui `em_producao`
-- perde o destino `enviado`, e pedir `enviado` responde com um erro que diz
-- para onde ir. O resto e o corpo da migration 20260925120000, igual.
--
-- A tabela de lib/loja/status-do-pedido.ts continua com `enviado`: e a lista
-- de botoes do painel, e o botao existe — so a porta e outra. O teste de
-- lib/loja/status-do-pedido.test.ts le ESTA migration e compara as duas
-- tabelas, tirando o `enviado`.

create or replace function public.muda_status_pedido(
  p_order_id uuid,
  p_para public.status_pedido,
  p_autor uuid,
  p_motivo text default null
)
returns table (de public.status_pedido, para public.status_pedido)
language plpgsql
-- INVOKER, como `cria_pedido`: quem chama (service_role) ja pode escrever em
-- `orders`. DEFINER daria a qualquer chamador os poderes do dono da funcao —
-- e o revoke do fim so protege enquanto ninguem der GRANT de novo.
security invoker
set search_path = ''
as $$
declare
  v_de public.status_pedido;
begin
  if p_autor is null then
    raise exception 'autor obrigatorio' using errcode = '22004';
  end if;
  if p_motivo is not null and char_length(p_motivo) > 300 then
    raise exception 'motivo longo demais' using errcode = '22001';
  end if;

  -- Enviado sem codigo de rastreio nao existe (#378). Antes da trava: nao ha
  -- o que ler do pedido para recusar isto.
  if p_para = 'enviado' then
    raise exception 'enviado so por envia_pedido, com o codigo de rastreio'
      using errcode = 'P0001',
            hint = 'use envia_pedido';
  end if;

  -- Trava a linha: duas pessoas clicando ao mesmo tempo nao aplicam duas
  -- transicoes a partir do mesmo estado antigo.
  select o.status into v_de
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'pedido nao encontrado' using errcode = 'P0002';
  end if;

  -- A tabela de transicoes, em SQL. E a de lib/loja/status-do-pedido.ts sem
  -- `enviado`, e um teste compara as duas. `pago` nao e destino: pagamento e
  -- do provedor.
  if not (
    (v_de = 'aguardando_pagamento' and p_para in ('cancelado')) or
    (v_de = 'pago'                 and p_para in ('em_producao', 'cancelado', 'reembolsado')) or
    (v_de = 'em_producao'          and p_para in ('cancelado', 'reembolsado')) or
    (v_de = 'enviado'              and p_para in ('entregue', 'reembolsado')) or
    (v_de = 'entregue'             and p_para in ('reembolsado'))
  ) then
    raise exception 'transicao nao permitida: % -> %', v_de, p_para
      using errcode = 'P0001';
  end if;

  -- Local a transacao (`true`): some no commit, e a trilha le enquanto o
  -- trigger roda. Nunca vaza para outra request da mesma conexao.
  perform set_config('app.autor', p_autor::text, true);
  perform set_config('app.motivo', coalesce(p_motivo, ''), true);

  update public.orders set status = p_para where id = p_order_id;

  return query select v_de, p_para;
end;
$$;

comment on function public.muda_status_pedido(uuid, public.status_pedido, uuid, text) is
  'Mudanca administrativa de status, com transicao validada e autor na trilha. Enviado so por envia_pedido. So service_role executa.';

-- `create or replace` guarda os privilegios da funcao. A fechadura da #43 vai
-- de novo assim mesmo, para esta migration nao depender disso.
revoke all on function public.muda_status_pedido(uuid, public.status_pedido, uuid, text)
  from public, anon, authenticated;
grant execute on function public.muda_status_pedido(uuid, public.status_pedido, uuid, text)
  to service_role;
