-- Issue #99 — catalogo de produtos, com o preco como fonte de verdade do servidor.
--
-- Ate aqui o preco morava no JSX:
--
--   app/page.tsx:124   <div className="preco"><small>R$</small>120</div>   (#merch)
--   app/page.tsx:194   <div className="preco"><small>R$</small>120</div>   (#loja, o mesmo produto)
--
-- e o nome aparecia em tres lugares, com a descricao escrita de dois jeitos
-- diferentes. Enquanto foi assim, a regra "o servidor recalcula o preco" nao
-- tinha como ser cumprida: nao havia preco no servidor para comparar.
--
-- Migration aditiva. Nenhuma tabela existente e tocada.
--
-- O principio da #18 continua valendo e fica mais visivel aqui:
--
--   o cliente LE o catalogo, o servidor ESCREVE o pedido
--
-- e por isso `anon` e `authenticated` recebem SELECT por COLUNA, nunca a tabela
-- inteira: quando alguem adicionar preco de custo ou margem, a coluna nasce
-- fechada em vez de nascer publica e esperar que alguem repare.

-- ---------------------------------------------------------------------------
-- produtos
-- ---------------------------------------------------------------------------

create table public.produtos (
  id uuid primary key default gen_random_uuid(),
  -- O mesmo formato de `order_items.produto_slug`, de proposito: e por ele que
  -- o pedido antigo continua sabendo o que foi comprado.
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,60}$'),
  nome text not null check (char_length(nome) between 1 and 120),
  descricao text check (descricao is null or char_length(descricao) between 1 and 400),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.produtos is
  'Catalogo. Fonte de verdade do preco (na variacao) e do nome. O pedido guarda copia propria — ver order_items.';

comment on column public.produtos.ativo is
  'Falso tira da loja sem apagar. Apagar produto quebraria a leitura de pedido antigo; desativar nao.';

create trigger produtos_atualizado_em
  before update on public.produtos
  for each row execute function public.toca_atualizado_em();

-- ---------------------------------------------------------------------------
-- produto_variacoes
-- ---------------------------------------------------------------------------

create table public.produto_variacoes (
  id uuid primary key default gen_random_uuid(),
  -- `restrict`, nao `cascade`: apagar um produto que tem variacao seria apagar
  -- o preco de um item que pode estar dentro de um pedido em andamento.
  produto_id uuid not null references public.produtos (id) on delete restrict,

  -- Mesma lista do check de `order_items.tamanho`. Se divergissem, o catalogo
  -- venderia um tamanho que o pedido nao aceita gravar.
  -- null = produto sem tamanho (adesivo, poster).
  tamanho text check (tamanho is null or tamanho in ('P', 'M', 'G', 'GG', 'XGG')),

  -- Inteiro em centavos, como `orders.total_centavos`. Dinheiro em float
  -- arredonda errado.
  --
  -- `> 0` e nao `>= 0`: preco zero nao e desconto, e bug ou ataque. Barrar no
  -- banco e mais barato do que descobrir depois por que um pedido saiu de
  -- graca. Se um dia existir brinde, a regra se afrouxa de proposito.
  preco_centavos integer not null check (preco_centavos > 0),

  -- null = estoque nao controlado. Zero seria diferente: zero bloqueia a
  -- venda. Hoje ninguem desconta daqui; quem define reserva, baixa e liberacao
  -- e a #100, junto com o codigo que mantem o numero.
  estoque integer check (estoque is null or estoque >= 0),

  ativo boolean not null default true,

  -- P, M, G, GG nao sao alfabeticos: por nome sairiam G, GG, M, P. A ordem e
  -- dado, nao detalhe de apresentacao.
  ordem smallint not null default 0,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on column public.produto_variacoes.estoque is
  'null = nao controlado. A regra de reserva e baixa e da Issue #100.';

create trigger produto_variacoes_atualizado_em
  before update on public.produto_variacoes
  for each row execute function public.toca_atualizado_em();

-- Um preco por tamanho. Em indice unico o NULL e distinto de outro NULL, entao
-- sem o indice parcial abaixo o mesmo produto poderia ter duas variacoes sem
-- tamanho — e duas linhas com precos diferentes para a mesma coisa.
create unique index produto_variacoes_tamanho
  on public.produto_variacoes (produto_id, tamanho)
  where tamanho is not null;

create unique index produto_variacoes_sem_tamanho
  on public.produto_variacoes (produto_id)
  where tamanho is null;

create index produto_variacoes_do_produto
  on public.produto_variacoes (produto_id, ordem);

-- ---------------------------------------------------------------------------
-- Privilegios: barreira 1
-- ---------------------------------------------------------------------------

revoke all on public.produtos from anon, authenticated;
revoke all on public.produto_variacoes from anon, authenticated;

-- SELECT por coluna. `estoque` fica de fora de proposito: quantas pecas restam
-- e informacao do negocio, nao da vitrine. Quem precisa do numero e a rota de
-- servidor que cria o pedido, e ela usa a chave secreta.
--
-- `atualizado_em` e `criado_em` tambem ficam fora: a loja nao mostra nenhum dos
-- dois, e coluna que ninguem usa nao precisa sair do banco.
grant select (id, slug, nome, descricao, ativo) on public.produtos to anon, authenticated;
grant select (id, produto_id, tamanho, preco_centavos, ativo, ordem)
  on public.produto_variacoes to anon, authenticated;

-- Nenhum insert, update ou delete para anon nem para authenticated. Preco e
-- escrito por rota de servidor com a chave secreta, e so.

-- ---------------------------------------------------------------------------
-- RLS: barreira 2
-- ---------------------------------------------------------------------------

alter table public.produtos enable row level security;
alter table public.produto_variacoes enable row level security;

create policy produtos_vitrine on public.produtos
  for select to anon, authenticated
  using (ativo);

-- O `exists` roda como invoker, entao a policy de `produtos` se aplica dentro
-- dele: variacao de produto desativado some junto com o produto, sem precisar
-- desativar uma por uma. Mesmo raciocinio de `pedido_e_meu` na #18 — security
-- definer aqui seria furo, nao conveniencia.
create policy produto_variacoes_vitrine on public.produto_variacoes
  for select to anon, authenticated
  using (
    ativo
    and exists (select 1 from public.produtos p where p.id = produto_id)
  );

-- ---------------------------------------------------------------------------
-- Seed: o que ja esta publicado hoje
-- ---------------------------------------------------------------------------

-- Nao e produto novo: e o mesmo texto e o mesmo preco que estao no ar em
-- app/page.tsx, movidos para ca. A descricao vem da versao de #merch; a de
-- #loja dizia a mesma coisa com outras palavras, e agora ha uma so.
--
-- `on conflict do nothing` para a migration poder rodar duas vezes sem
-- duplicar nem sobrescrever um preco que alguem tenha ajustado depois.
insert into public.produtos (slug, nome, descricao)
values (
  'camiseta-cbac',
  'Camiseta CBAC x Passem a Respeitar',
  'Preta, oversized, estampa branca do brasão CBAC no peito. Edição do EP.'
)
on conflict (slug) do nothing;

insert into public.produto_variacoes (produto_id, tamanho, preco_centavos, ordem)
select p.id, t.tamanho, 12000, t.ordem
from public.produtos p
cross join (values ('P', 1), ('M', 2), ('G', 3), ('GG', 4)) as t(tamanho, ordem)
where p.slug = 'camiseta-cbac'
on conflict do nothing;
