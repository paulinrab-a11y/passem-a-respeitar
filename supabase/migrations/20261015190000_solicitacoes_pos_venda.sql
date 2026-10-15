-- Issue #379 — cancelar e desistir da compra pelo site (achado A2 da auditoria).
--
-- O Decreto 7.962/2013, art. 5º, pede que o arrependimento possa ser exercido
-- pela mesma ferramenta usada para comprar (§ 1º) e que o recebimento seja
-- confirmado na hora (§ 4º). Ate aqui, o detalhe do pedido so tinha um
-- `mailto:`. Esta migration cria o lugar onde o pedido de cancelamento,
-- desistencia, troca ou defeito fica registrado, com protocolo.
--
-- So adicoes: tabela, tipo, funcao e um trigger novo em `orders`. O codigo
-- que esta em producao nao le nem escreve nada disto.
--
-- Quem escreve: a propria pessoa, pela API, com a chave publica e a sessao
-- dela. A regra de QUANDO pode pedir mora aqui, na policy, e nao so na tela:
-- pedido de outra pessoa, status errado ou prazo vencido sao recusados pelo
-- banco, chame quem chamar. Quem resolve: o dono da loja, pelo painel, com a
-- chave de servico.

create type public.tipo_pos_venda as enum (
  'cancelamento',   -- pago ou em producao: ainda nao saiu
  'arrependimento', -- entregue, dentro de ARREPENDIMENTO_DIAS (CDC art. 49)
  'troca',          -- entregue, dentro de TROCA_DE_TAMANHO_DIAS (cortesia)
  'defeito'         -- entregue; vicio oculto conta de quando aparece
);

create table public.solicitacoes_pos_venda (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  -- `default auth.uid()`: a pessoa nao escolhe de quem e a solicitacao — ela
  -- nem tem INSERT nesta coluna (ver os grants). `on delete set null`, como
  -- `orders.user_id` (#39): a conta sai, o registro do pedido fica, sem dono.
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  tipo public.tipo_pos_venda not null,
  -- Opcional e curta: o tamanho da troca, o que aconteceu com a peca. Nao e
  -- canal de conversa; o e-mail continua sendo.
  mensagem text check (mensagem is null or char_length(mensagem) between 1 and 500),
  -- Legivel e falavel ao telefone: PV- e oito caracteres hexadecimais. Nao e
  -- segredo nem chave de acesso (a RLS e quem decide quem le), so o numero
  -- que a pessoa cita. Aleatorio, e nao sequencial, para nao contar quantas
  -- solicitacoes a loja recebe.
  protocolo text not null unique
    default ('PV-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 8))),
  criado_em timestamptz not null default now(),
  -- Nulo enquanto aberta. O painel marca; cancelar ou reembolsar o pedido
  -- marca sozinho (trigger abaixo).
  resolvida_em timestamptz,
  check (resolvida_em is null or resolvida_em >= criado_em)
);

comment on table public.solicitacoes_pos_venda is
  'Pedidos de cancelamento, desistencia, troca e defeito feitos pelo site, com protocolo (#379). A pessoa cria e le as proprias; o dono resolve pela chave de servico.';

-- Uma aberta por pedido e tipo: clicar duas vezes nao gera dois protocolos,
-- e a tela mostra o que ja existe.
create unique index solicitacoes_pos_venda_uma_aberta
  on public.solicitacoes_pos_venda (order_id, tipo)
  where resolvida_em is null;

-- A chave estrangeira e o `on delete cascade` precisam do indice inteiro: o
-- parcial acima nao serve para achar as resolvidas.
create index solicitacoes_pos_venda_order_id on public.solicitacoes_pos_venda (order_id);
create index solicitacoes_pos_venda_user_id on public.solicitacoes_pos_venda (user_id);
-- O contador do painel: so as abertas, da mais antiga para a mais nova.
create index solicitacoes_pos_venda_abertas
  on public.solicitacoes_pos_venda (criado_em)
  where resolvida_em is null;

-- ---------------------------------------------------------------------------
-- Quando cabe pedir
-- ---------------------------------------------------------------------------

-- A mesma regra de lib/loja/termos.ts (`posVendaDoPedido`) e de
-- lib/conta/pos-venda.ts, e um teste confere os numeros: 7 dias corridos
-- contados do primeiro registro de "entregue" na trilha, no fuso de Sao
-- Paulo, com o ultimo dia inteiro. Sem registro de entrega (pedido antigo),
-- o prazo nao e calculado e o pedido e aceito: o direito conta do dia em que
-- a pessoa recebeu, e o banco nao sabe esse dia.
--
-- INVOKER, como `pedido_e_meu`: a RLS de `orders` e de `order_status_history`
-- vale aqui dentro, entao o pedido de outra pessoa nem e encontrado. O filtro
-- por `auth.uid()` e repetido para a funcao continuar certa se um dia rodar
-- com outro papel.
create function public.pos_venda_cabe(p_order_id uuid, p_tipo public.tipo_pos_venda)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.orders o
    left join lateral (
      select min(h.criado_em) as em
      from public.order_status_history h
      where h.order_id = o.id and h.para = 'entregue'
    ) entrega on true
    where o.id = p_order_id
      and o.user_id = (select auth.uid())
      and case p_tipo
        when 'cancelamento' then o.status in ('pago', 'em_producao')
        when 'arrependimento' then o.status = 'entregue' and (
          entrega.em is null
          or (now() at time zone 'America/Sao_Paulo')::date
            <= (entrega.em at time zone 'America/Sao_Paulo')::date + 7 -- ARREPENDIMENTO_DIAS
        )
        when 'troca' then o.status = 'entregue' and (
          entrega.em is null
          or (now() at time zone 'America/Sao_Paulo')::date
            <= (entrega.em at time zone 'America/Sao_Paulo')::date + 7 -- TROCA_DE_TAMANHO_DIAS
        )
        -- Defeito nao tem prazo aqui: o aparente vai ate GARANTIA_DIAS, mas o
        -- oculto conta de quando aparece (CDC art. 26, § 3º), dia que o banco
        -- nao sabe. Recusar seria dizer que o direito acabou.
        when 'defeito' then o.status = 'entregue'
        else false
      end
  );
$$;

comment on function public.pos_venda_cabe(uuid, public.tipo_pos_venda) is
  'Se a pessoa da sessao pode abrir esta solicitacao para este pedido agora. Usada na policy de insert de solicitacoes_pos_venda (#379).';

-- A policy roda com o papel de quem insere, e chamar funcao pede EXECUTE.
-- `authenticated` precisa; `anon`, nao. Chamada direto pela API ela so
-- responde sobre pedido da propria pessoa — a RLS ve o resto como vazio.
revoke all on function public.pos_venda_cabe(uuid, public.tipo_pos_venda) from public, anon;
grant execute on function public.pos_venda_cabe(uuid, public.tipo_pos_venda) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS e grants
-- ---------------------------------------------------------------------------

alter table public.solicitacoes_pos_venda enable row level security;

-- O Supabase da ALL em tabela nova para anon e authenticated. Comeca do zero
-- e devolve so o que a tela usa.
revoke all on public.solicitacoes_pos_venda from anon, authenticated;

-- Ler: tudo menos `user_id`, que a tela nao usa (a linha ja e da pessoa).
grant select (id, order_id, tipo, mensagem, protocolo, criado_em, resolvida_em)
  on public.solicitacoes_pos_venda to authenticated;

-- Criar: so as tres colunas que a pessoa escolhe. `user_id`, `protocolo`,
-- `criado_em` e `resolvida_em` vem do default e ninguem de fora os escreve —
-- nem um "ja resolvida" para escapar do indice de uma aberta por tipo.
grant insert (order_id, tipo, mensagem) on public.solicitacoes_pos_venda to authenticated;

-- Sem UPDATE e sem DELETE para a pessoa: o registro do pedido feito nao se
-- apaga nem se reescreve. Desistir de um pedido de cancelamento e falar com a
-- loja.

create policy solicitacoes_pos_venda_le_as_proprias on public.solicitacoes_pos_venda
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy solicitacoes_pos_venda_cria_quando_cabe on public.solicitacoes_pos_venda
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and public.pos_venda_cabe(order_id, tipo)
  );

-- ---------------------------------------------------------------------------
-- Cancelar ou reembolsar o pedido encerra o que estava aberto
-- ---------------------------------------------------------------------------

-- O dono resolve pelo botao que ja existe (#22): reembolsar estorna e muda o
-- status. Sem isto, a solicitacao ficaria aberta no contador do painel
-- depois de atendida. AFTER e por linha: so roda quando o status muda de
-- fato para um dos dois finais.
--
-- DEFINER porque quem muda o status nem sempre e o service_role: o `update`
-- na mao pelo painel do Supabase e o postgres. A funcao so faz uma coisa, com
-- o id do proprio pedido, e nao e chamavel pela API (revoke abaixo).
create function public.encerra_solicitacoes_do_pedido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.solicitacoes_pos_venda
  set resolvida_em = now()
  where order_id = new.id and resolvida_em is null;
  return null;
end;
$$;

revoke all on function public.encerra_solicitacoes_do_pedido() from public, anon, authenticated;

create trigger orders_encerra_solicitacoes
  after update of status on public.orders
  for each row
  when (new.status in ('cancelado', 'reembolsado') and old.status is distinct from new.status)
  execute function public.encerra_solicitacoes_do_pedido();
