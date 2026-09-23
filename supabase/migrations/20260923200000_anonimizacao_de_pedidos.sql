-- Issue #39 — exclusao de conta com anonimizacao do pedido.
--
-- Decisao do Paulo: o pedido fica, o vinculo com a pessoa sai. A LGPD permite
-- reter por obrigacao legal (Art. 16, II), e dado anonimizado sai do alcance
-- da lei (Art. 12). Apagar a venda junto seria perder o registro fiscal de
-- dinheiro que entrou.

-- O `on delete restrict` da migration 20260923120000 existia para pedido nao
-- sumir quando o dono apaga a conta. A intencao continua valendo; muda o
-- mecanismo: em vez de impedir a exclusao, o vinculo e cortado.
alter table public.orders drop constraint orders_user_id_fkey;
alter table public.orders alter column user_id drop not null;
alter table public.orders
  add constraint orders_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;

-- Marca o que foi anonimizado, para distinguir de um user_id nulo por bug.
alter table public.orders add column anonimizado_em timestamptz;

comment on column public.orders.anonimizado_em is
  'Quando o dono excluiu a conta. O pedido fica para a contabilidade; o vinculo com a pessoa nao.';

-- ---------------------------------------------------------------------------
-- O trigger de dono imutavel precisava saber disto
-- ---------------------------------------------------------------------------

-- `on delete set null` executa um UPDATE na linha referenciadora, e esse
-- UPDATE dispara o trigger. Sem a excecao abaixo, o trigger que eu escrevi
-- para proteger o pedido impediria a exclusao da conta — a protecao viraria
-- o bug.
--
-- A excecao e de mao unica: de dono para nulo pode, o resto continua barrado.
-- Transferir pedido de uma pessoa para outra segue impossivel.
create or replace function public.pedido_dono_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is null and old.user_id is not null then
    return new;
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'user_id de pedido e imutavel (pedido %)', old.id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- A RLS nao precisa mudar, e vale dizer por que
-- ---------------------------------------------------------------------------

-- `orders_le_os_proprios` usa `(select auth.uid()) = user_id`. Com user_id
-- nulo a comparacao nunca da verdadeiro, entao pedido anonimizado fica
-- invisivel para todo mundo que nao seja service_role. E exatamente o que se
-- quer: ele existe para a contabilidade, nao para a tela de ninguem.
