-- Issue #102 — modelo de dados do checkout: pagamento, endereco e anonimizacao.
--
-- Migration aditiva. Nenhuma coluna removida, nenhum dado alterado.
--
-- Duas ideias organizam o arquivo:
--
--   1. O eixo FINANCEIRO nao e o eixo COMERCIAL.
--
--      `orders.status` e logistica: aguardando_pagamento -> pago -> em_producao
--      -> enviado -> entregue. Pagamento tem outro eixo, e misturar os dois
--      impede o que o checkout precisa: cartao recusado NAO cancela o pedido, e
--      a pessoa tenta de novo. Por isso `pagamentos` tem `tentativa`.
--
--   2. Anonimizacao e trigger, nao rota.
--
--      Hoje `excluir.ts` carimba `anonimizado_em` antes de apagar o usuario.
--      Funciona — mas e codigo de aplicacao, e o argumento da #18 vale aqui:
--      "Rota esquece; trigger nao". Com endereco na linha, esquecer significa
--      deixar nome, rua e CEP de quem pediu para ser esquecido.

-- ---------------------------------------------------------------------------
-- Endereco de entrega: snapshot no pedido
-- ---------------------------------------------------------------------------

-- Colunas no proprio pedido, e nao tabela a parte: e um endereco por pedido, e
-- e SNAPSHOT — mudar o endereco do perfil depois nao pode mudar para onde um
-- pedido antigo foi enviado. Tabela 1:1 seria um join para nada.
--
-- Nullable porque pedido so ganha endereco no checkout, e a coluna nasce em
-- tabela que ja tem linhas (hoje zero, mas a migration nao pode depender
-- disso). A obrigatoriedade e do fluxo de criacao do pedido.
--
-- Nao ha CPF nem telefone aqui. CPF e dado do pagador, pedido pelo provedor na
-- hora de cobrar, e nao precisa ficar guardado. Telefone ja existe em
-- `profiles`. Coletar de novo seria coletar sem necessidade.
alter table public.orders
  add column entrega_nome text check (entrega_nome is null or char_length(entrega_nome) between 2 and 120),
  add column entrega_cep text check (entrega_cep is null or entrega_cep ~ '^[0-9]{8}$'),
  add column entrega_logradouro text check (entrega_logradouro is null or char_length(entrega_logradouro) between 2 and 160),
  add column entrega_numero text check (entrega_numero is null or char_length(entrega_numero) between 1 and 20),
  add column entrega_complemento text check (entrega_complemento is null or char_length(entrega_complemento) <= 80),
  add column entrega_bairro text check (entrega_bairro is null or char_length(entrega_bairro) between 2 and 80),
  add column entrega_cidade text check (entrega_cidade is null or char_length(entrega_cidade) between 2 and 80),
  add column entrega_uf text check (entrega_uf is null or entrega_uf ~ '^[A-Z]{2}$');

comment on column public.orders.entrega_cep is
  'So digitos, sem hifen. Normalizado antes de gravar.';

comment on column public.orders.entrega_nome is
  'Destinatario. Pode nao ser o titular da conta — presente, endereco de terceiro.';

-- ---------------------------------------------------------------------------
-- Anonimizacao: agora inclui o endereco, e acontece sozinha
-- ---------------------------------------------------------------------------

-- `on delete set null` (migration 20260923200000) executa um UPDATE na linha,
-- e e nesse UPDATE que da para agir. O trigger abaixo pega a transicao
-- "tinha dono, agora nao tem" e limpa o que identifica a pessoa.
--
-- Vale inclusive para exclusao feita direto no painel do Supabase — caminho
-- que hoje deixaria `anonimizado_em` nulo e o endereco inteiro na tabela.
--
-- O que NAO e limpo, de proposito: numero, valor, itens e datas. E o registro
-- fiscal do dinheiro que entrou, que a LGPD permite reter (Art. 16, II), e sem
-- vinculo com pessoa ele e dado anonimizado (Art. 12).
create or replace function public.anonimiza_pedido()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is null and old.user_id is not null then
    new.entrega_nome := null;
    new.entrega_cep := null;
    new.entrega_logradouro := null;
    new.entrega_numero := null;
    new.entrega_complemento := null;
    new.entrega_bairro := null;
    new.entrega_cidade := null;
    new.entrega_uf := null;

    -- `coalesce`: se a rota ja carimbou antes de apagar o usuario, respeita a
    -- hora dela. Se ninguem carimbou, carimba agora.
    new.anonimizado_em := coalesce(new.anonimizado_em, now());
  end if;

  return new;
end;
$$;

comment on function public.anonimiza_pedido is
  'Limpa o endereco quando o pedido perde o dono. Roda no UPDATE do on delete set null.';

-- Postgres dispara trigger BEFORE de linha em ordem alfabetica pelo NOME, e
-- `orders_anonimiza` vem antes de `orders_dono_imutavel`. A ordem nao importa
-- aqui, e vale registrar por que: este trigger nao toca em `user_id`, e o
-- outro ja libera a transicao para nulo. Os dois leem a mesma condicao e
-- nenhum depende do resultado do outro.
create trigger orders_anonimiza
  before update on public.orders
  for each row execute function public.anonimiza_pedido();

-- ---------------------------------------------------------------------------
-- Estado interno do pagamento
-- ---------------------------------------------------------------------------

-- Vocabulario NOSSO, nao o do provedor. A Orders API do Mercado Pago responde
-- `processed`/`accredited` e `action_required`/`waiting_transfer`; a Payments
-- API, que a documentacao ja marca como legado, falava `approved`/`pending`.
-- Um enum copiado de um dos dois envelhece com ele.
--
-- O status cru do provedor fica guardado em coluna propria, do lado.
create type public.estado_pagamento as enum (
  'criado',     -- tentativa registrada aqui, ainda nao foi ao provedor
  'pendente',   -- Pix esperando transferencia, cartao em analise
  'aprovado',
  'recusado',   -- cartao negado. NAO cancela o pedido: cabe outra tentativa
  'cancelado',  -- expirou ou foi cancelado
  'estornado'
);

-- ---------------------------------------------------------------------------
-- pagamentos
-- ---------------------------------------------------------------------------

create table public.pagamentos (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,

  -- 1, 2, 3... Uma linha por tentativa e o que permite "cartao recusado, tenta
  -- de novo" sem apagar o historico da tentativa anterior.
  tentativa smallint not null check (tentativa between 1 and 20),

  provedor text not null default 'mercadopago' check (provedor in ('mercadopago')),

  -- Id da ordem/pagamento no provedor. Nulo ate a chamada voltar — e e por isso
  -- que a linha nasce antes da chamada: se a resposta se perder no meio, a
  -- tentativa ja esta registrada e a conciliacao acha.
  provedor_pagamento_id text,

  metodo text check (metodo is null or metodo in ('pix', 'credit_card', 'debit_card')),

  estado public.estado_pagamento not null default 'criado',

  -- O que o provedor respondeu, sem traducao. Guardar o cru e o que permite
  -- corrigir o mapa depois sem perder a informacao original.
  provedor_status text,
  provedor_status_detail text,

  -- Quanto foi cobrado nesta tentativa. Repetido de `orders.total_centavos` de
  -- proposito: se o valor do pedido mudar, esta linha continua dizendo quanto
  -- a cobranca foi — e conciliacao compara com o extrato, nao com o pedido.
  valor_centavos integer not null check (valor_centavos > 0),
  moeda text not null default 'BRL' check (moeda = 'BRL'),

  -- Enviada como `X-Idempotency-Key`. Estavel POR TENTATIVA: reenviar a mesma
  -- tentativa (timeout, clique duplo) reusa a chave e o provedor devolve a
  -- mesma cobranca em vez de criar outra. Gerar chave nova a cada retry
  -- derrotaria a idempotencia justamente no retry.
  idempotency_key uuid not null default gen_random_uuid(),

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.pagamentos is
  'Eixo financeiro. Uma linha por tentativa. orders.status continua sendo o eixo comercial.';

comment on column public.pagamentos.idempotency_key is
  'X-Idempotency-Key da chamada. Nunca sai para o cliente — ver o GRANT por coluna.';

-- Clique duplo cria duas linhas com a mesma tentativa; o indice recusa a
-- segunda. A recusa E a protecao contra cobranca duplicada.
create unique index pagamentos_tentativa on public.pagamentos (order_id, tentativa);

create unique index pagamentos_idempotencia on public.pagamentos (idempotency_key);

-- Mesmo papel do `orders_pagamento_unico` da #18: o provedor reenvia, e sem
-- isto a mesma cobranca viraria duas linhas.
create unique index pagamentos_do_provedor
  on public.pagamentos (provedor, provedor_pagamento_id)
  where provedor_pagamento_id is not null;

create index pagamentos_do_pedido on public.pagamentos (order_id, criado_em desc);

create trigger pagamentos_atualizado_em
  before update on public.pagamentos
  for each row execute function public.toca_atualizado_em();

-- ---------------------------------------------------------------------------
-- pagamento_eventos: o log que torna o webhook idempotente
-- ---------------------------------------------------------------------------

create table public.pagamento_eventos (
  id uuid primary key default gen_random_uuid(),

  -- Nulo quando o evento chega antes de a gente saber a que pagamento ele
  -- pertence. Guardar mesmo assim e melhor que descartar: a conciliacao
  -- precisa saber que chegou.
  pagamento_id uuid references public.pagamentos (id) on delete set null,

  provedor text not null default 'mercadopago' check (provedor in ('mercadopago')),

  -- Id da notificacao no provedor. E ESTE indice unico que torna o reenvio
  -- inofensivo: o processamento tenta inserir primeiro; se conflitar, o evento
  -- ja foi tratado e nao se faz nada de novo.
  evento_id text not null,

  tipo text,
  provedor_status text,

  -- Carimbo do provedor, para detectar evento fora de ordem: notificacao
  -- antiga nao pode reverter um estado mais novo.
  ocorrido_em timestamptz,
  recebido_em timestamptz not null default now()
);

comment on table public.pagamento_eventos is
  'Log de webhook. O unique (provedor, evento_id) e a idempotencia do reenvio.';

create unique index pagamento_eventos_unico on public.pagamento_eventos (provedor, evento_id);
create index pagamento_eventos_do_pagamento on public.pagamento_eventos (pagamento_id, recebido_em desc);

-- ---------------------------------------------------------------------------
-- Privilegios: barreira 1
-- ---------------------------------------------------------------------------

revoke all on public.pagamentos from anon, authenticated;
revoke all on public.pagamento_eventos from anon, authenticated;

-- SELECT por coluna. `idempotency_key` fica de fora: e o que garante que a
-- cobranca nao duplica, e quem a conhece pode tentar interferir numa retentativa.
-- `provedor_pagamento_id` tambem fica de fora — e identificador de conciliacao,
-- nao dado da tela.
grant select (id, order_id, tentativa, metodo, estado, valor_centavos, moeda, criado_em)
  on public.pagamentos to authenticated;

-- `pagamento_eventos` nao recebe GRANT nenhum. E auditoria de servidor; a tela
-- nao mostra e o cliente nao tem o que fazer com ela.

-- Nenhum insert, update ou delete para o cliente em nenhuma das duas. Quem
-- escreve pagamento e rota de servidor; quem escreve evento e o webhook.

-- ---------------------------------------------------------------------------
-- RLS: barreira 2
-- ---------------------------------------------------------------------------

alter table public.pagamentos enable row level security;
alter table public.pagamento_eventos enable row level security;

-- `pedido_e_meu` e da #18 e roda como invoker: a RLS de `orders` se aplica
-- dentro dela, entao so acha pedido que o proprio usuario ja enxergaria.
-- Pedido anonimizado tem user_id nulo, entao some junto — o pagamento de quem
-- excluiu a conta nao volta para tela nenhuma.
create policy pagamentos_le_do_proprio_pedido on public.pagamentos
  for select to authenticated
  using (public.pedido_e_meu(order_id));

-- `pagamento_eventos` fica com RLS ligada e SEM policy: sem GRANT e sem policy,
-- e invisivel duas vezes. As duas barreiras de propósito — uma policy
-- adicionada por engano no futuro ainda esbarra no GRANT.
