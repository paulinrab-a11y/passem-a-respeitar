-- Issue #18 — modelo de dados da area de conta, com RLS.
--
-- Principio que organiza o arquivo inteiro: o cliente le, o servidor escreve.
-- Pedido nasce numa rota de servidor que calcula preco a partir do catalogo.
-- Preco que chega do navegador nao e preco, e sugestao.
--
-- Por isso `authenticated` recebe SELECT nas tabelas de pedido e mais nada.
-- Sao tres barreiras empilhadas, e cada uma sozinha ja barraria:
--   1. GRANT      — o papel nao tem o privilegio de escrita
--   2. RLS        — nao existe policy de insert/update/delete para ele
--   3. TRIGGER    — user_id nao muda nem por service_role (protege contra bug nosso)

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------

create type public.status_pedido as enum (
  'aguardando_pagamento',
  'pago',
  'em_producao',
  'enviado',
  'entregue',
  'cancelado',
  'reembolsado'
);

-- ---------------------------------------------------------------------------
-- Utilitarios
-- ---------------------------------------------------------------------------

create or replace function public.toca_atualizado_em()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text check (char_length(nome) <= 80),
  telefone text check (telefone is null or telefone ~ '^[0-9+() -]{8,20}$'),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.profiles is
  'Dado de perfil do usuario. Nada de credencial: senha e sessao vivem em auth.';

create trigger profiles_atualizado_em
  before update on public.profiles
  for each row execute function public.toca_atualizado_em();

-- O perfil nasce junto com o usuario. Sem isso, cada rota que le perfil
-- precisaria tratar o caso "usuario existe mas perfil nao".
--
-- `left(..., 80)` no lugar de deixar o check constraint decidir: o metadata do
-- signup e texto que o proprio usuario manda, e um nome comprido derrubaria o
-- cadastro inteiro em vez de so truncar.
create or replace function public.cria_profile_no_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nome)
  values (new.id, left(nullif(trim(new.raw_user_meta_data ->> 'nome'), ''), 80))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.cria_profile_no_signup();

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  -- Numero curto para o usuario citar no suporte. O id continua sendo uuid
  -- porque numero sequencial em URL entrega quantos pedidos a loja tem.
  numero bigint generated always as identity,
  user_id uuid not null references auth.users (id) on delete restrict,
  status public.status_pedido not null default 'aguardando_pagamento',
  total_centavos integer not null default 0 check (total_centavos >= 0),
  moeda text not null default 'BRL' check (moeda = 'BRL'),
  pagamento_provedor text check (pagamento_provedor in ('mercadopago')),
  pagamento_id text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on column public.orders.total_centavos is
  'Inteiro em centavos de proposito. Dinheiro em float arredonda errado.';

-- Idempotencia do webhook: o Mercado Pago reenvia a mesma notificacao, e sem
-- isso o mesmo pagamento viraria dois pedidos.
create unique index orders_pagamento_unico
  on public.orders (pagamento_provedor, pagamento_id)
  where pagamento_id is not null;

create index orders_user_id_criado_em on public.orders (user_id, criado_em desc);

create trigger orders_atualizado_em
  before update on public.orders
  for each row execute function public.toca_atualizado_em();

-- user_id e imutavel. Nao e defesa contra o cliente (ele nem tem UPDATE), e
-- contra nos: um update mal escrito numa rota de servidor com service_role
-- transferiria o pedido de dono em silencio.
create or replace function public.pedido_dono_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id de pedido e imutavel (pedido %)', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger orders_dono_imutavel
  before update on public.orders
  for each row execute function public.pedido_dono_imutavel();

-- ---------------------------------------------------------------------------
-- order_items
-- ---------------------------------------------------------------------------

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  produto_slug text not null check (produto_slug ~ '^[a-z0-9-]{1,60}$'),
  nome text not null check (char_length(nome) between 1 and 120),
  tamanho text check (tamanho in ('P', 'M', 'G', 'GG', 'XGG')),
  quantidade integer not null check (quantidade between 1 and 10),
  -- Copia do preco no momento da compra. Se a tabela de precos mudar depois,
  -- o historico do pedido nao pode mudar junto.
  preco_unitario_centavos integer not null check (preco_unitario_centavos >= 0),
  criado_em timestamptz not null default now()
);

create index order_items_order_id on public.order_items (order_id);

-- ---------------------------------------------------------------------------
-- order_status_history
-- ---------------------------------------------------------------------------

create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  de public.status_pedido,
  para public.status_pedido not null,
  motivo text check (char_length(motivo) <= 300),
  -- Quem mandou mudar. null = automacao (webhook de pagamento).
  autor uuid references auth.users (id) on delete set null,
  criado_em timestamptz not null default now()
);

create index order_status_history_order_id
  on public.order_status_history (order_id, criado_em desc);

-- A trilha e escrita por trigger, nao pela rota que muda o status. Rota
-- esquece; trigger nao. Vale inclusive para update feito na mao no painel.
create or replace function public.registra_status_pedido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history (order_id, de, para, autor)
    values (new.id, null, new.status, auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.order_status_history (order_id, de, para, autor)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return null;
end;
$$;

create trigger orders_registra_status_insert
  after insert on public.orders
  for each row execute function public.registra_status_pedido();

create trigger orders_registra_status_update
  after update of status on public.orders
  for each row execute function public.registra_status_pedido();

-- ---------------------------------------------------------------------------
-- Privilegios: barreira 1
-- ---------------------------------------------------------------------------

-- O Supabase concede tudo a anon e authenticated por padrao em tabela nova no
-- schema public. Aqui esse padrao e desfeito e so o necessario volta.
revoke all on public.profiles from anon, authenticated;
revoke all on public.orders from anon, authenticated;
revoke all on public.order_items from anon, authenticated;
revoke all on public.order_status_history from anon, authenticated;

-- UPDATE por coluna: e isto, e nao a RLS, que impede mass assignment. Policy
-- decide quais LINHAS o usuario alcanca, nunca quais COLUNAS ele escreve.
grant select, insert on public.profiles to authenticated;
grant update (nome, telefone) on public.profiles to authenticated;

grant select on public.orders to authenticated;
grant select on public.order_items to authenticated;
grant select on public.order_status_history to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: barreira 2
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;

-- `(select auth.uid())` em vez de `auth.uid()`: com o select o planner avalia
-- uma vez por query, em vez de uma vez por linha varrida.

create policy profiles_le_o_proprio on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy profiles_cria_o_proprio on public.profiles
  for insert to authenticated
  with check ((select auth.uid()) = id);

create policy profiles_edita_o_proprio on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Sem policy de delete, de proposito. Apagar a linha de profiles deixaria o
-- usuario em auth.users sem perfil, que e pior que nao apagar nada. A exclusao
-- de conta da LGPD apaga o usuario em auth (#41) e o cascade leva o perfil.

create policy orders_le_os_proprios on public.orders
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Sem insert, update ou delete para o cliente em orders, order_items e
-- order_status_history. Pedido e criado e alterado por rota de servidor, que
-- calcula o total a partir do catalogo. Se o cliente pudesse inserir, ele
-- escolheria o proprio preco.

-- Filho herda o dono do pai. A funcao roda como invoker: a RLS de orders se
-- aplica dentro dela, entao o exists so acha pedido que o proprio usuario ja
-- enxergaria. Security definer aqui seria um furo, nao uma conveniencia.
create or replace function public.pedido_e_meu(p_order_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.orders o where o.id = p_order_id
  );
$$;

create policy order_items_le_do_proprio_pedido on public.order_items
  for select to authenticated
  using (public.pedido_e_meu(order_id));

create policy order_status_history_le_do_proprio_pedido on public.order_status_history
  for select to authenticated
  using (public.pedido_e_meu(order_id));
