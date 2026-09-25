-- Issue #43 — mudanca administrativa de status do pedido.
--
-- Duas coisas, e a segunda so faz sentido por causa da primeira:
--
--   1. A trilha (`registra_status_pedido`) passa a aceitar autor e motivo por
--      configuracao de transacao. Hoje ela grava `auth.uid()`, que e null
--      quando quem escreve e o service_role — e o service_role e justamente
--      quem executa a rota administrativa. Sem isto, toda mudanca feita por
--      uma pessoa apareceria na trilha como "automacao".
--
--   2. `muda_status_pedido` e a UNICA porta para status mudar por mao humana.
--      Valida a transicao no banco (a rota valida antes, mas rota se
--      esquece; banco nao), carimba autor e motivo, e so o service_role
--      executa. O cliente nunca chega aqui: o papel de administrador vive no
--      servidor (variavel de ambiente), e a rota so chama isto depois de
--      conferir.
--
-- O que NAO muda: o webhook e a conciliacao continuam fazendo
-- `update orders set status = 'pago'` direto, sem autor — e automacao, e a
-- trilha registra como tal. `pago` nao esta entre os destinos desta funcao
-- de proposito: pagamento quem confirma e o provedor, nunca uma pessoa.

-- ---------------------------------------------------------------------------
-- 1. trilha com autor e motivo opcionais
-- ---------------------------------------------------------------------------

create or replace function public.registra_status_pedido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_autor uuid;
  v_motivo text;
begin
  -- `current_setting(..., true)` devolve null quando a chave nao existe, em
  -- vez de erro. Sem configuracao, cai no `auth.uid()` de sempre — inclusive
  -- para update feito na mao no painel, que continua registrado.
  v_autor := coalesce(
    nullif(current_setting('app.autor', true), '')::uuid,
    auth.uid()
  );
  v_motivo := nullif(current_setting('app.motivo', true), '');

  if tg_op = 'INSERT' then
    insert into public.order_status_history (order_id, de, para, autor, motivo)
    values (new.id, null, new.status, v_autor, v_motivo);
  elsif new.status is distinct from old.status then
    insert into public.order_status_history (order_id, de, para, autor, motivo)
    values (new.id, old.status, new.status, v_autor, v_motivo);
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. a porta administrativa
-- ---------------------------------------------------------------------------

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

  -- Trava a linha: duas pessoas clicando ao mesmo tempo nao aplicam duas
  -- transicoes a partir do mesmo estado antigo.
  select o.status into v_de
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'pedido nao encontrado' using errcode = 'P0002';
  end if;

  -- A tabela de transicoes, em SQL. E a mesma de lib/loja/status-do-pedido.ts,
  -- e um teste compara as duas. `pago` nao e destino: pagamento e do provedor.
  if not (
    (v_de = 'aguardando_pagamento' and p_para in ('cancelado')) or
    (v_de = 'pago'                 and p_para in ('em_producao', 'cancelado', 'reembolsado')) or
    (v_de = 'em_producao'          and p_para in ('enviado', 'cancelado', 'reembolsado')) or
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
  'Mudanca administrativa de status, com transicao validada e autor na trilha. So service_role executa — ver o revoke abaixo.';

-- O Supabase concede EXECUTE a public em funcao nova. Sem isto, qualquer
-- usuario logado mudaria o status do pedido de qualquer um com uma chamada RPC.
revoke all on function public.muda_status_pedido(uuid, public.status_pedido, uuid, text)
  from public, anon, authenticated;
grant execute on function public.muda_status_pedido(uuid, public.status_pedido, uuid, text)
  to service_role;
