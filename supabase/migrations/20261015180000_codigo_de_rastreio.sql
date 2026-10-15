-- Issue #378 — codigo de rastreio no pedido enviado (achado A4 da auditoria).
--
-- O pedido ia para `enviado` sem nada que a pessoa pudesse acompanhar. Agora:
--
--   1. `orders` ganha `rastreio_codigo` e `rastreio_url`. So adicoes: o
--      codigo que esta em producao hoje nao le nem escreve nenhuma das duas,
--      e continua funcionando com esta migration aplicada.
--
--   2. `envia_pedido` e a porta para `em_producao -> enviado` COM o codigo:
--      status e rastreio mudam no mesmo UPDATE, na mesma transacao. Nao ha
--      instante em que o pedido esta "Enviado" para o cliente sem o codigo,
--      nem codigo gravado num pedido que nao saiu.
--
-- O que NAO muda ainda, de proposito: `muda_status_pedido` continua aceitando
-- `enviado` sem codigo. O painel que esta em producao chama essa funcao para
-- marcar enviado, e o deploy novo esta parado; recusar ali agora quebraria o
-- botao do dono ate o deploy. Quando o codigo novo estiver no ar, uma
-- migration seguinte tira `enviado` dos destinos de `muda_status_pedido`, e o
-- unico caminho passa a ser este.

-- ---------------------------------------------------------------------------
-- 1. colunas
-- ---------------------------------------------------------------------------

alter table public.orders
  add column rastreio_codigo text,
  add column rastreio_url text;

-- Formato do objeto dos Correios (padrao S10 da UPU): duas letras do tipo de
-- servico, oito digitos e o digito verificador, e a sigla do pais. SEDEX e o
-- que a loja usa (#199), e o Melhor Envio devolve a etiqueta nesse formato.
-- Maiusculas so: a acao normaliza antes, e o banco nao aceita duas grafias do
-- mesmo codigo.
alter table public.orders
  add constraint orders_rastreio_codigo_formato
    check (rastreio_codigo is null or rastreio_codigo ~ '^[A-Z]{2}[0-9]{9}[A-Z]{2}$');

-- Link opcional (a pagina do Melhor Envio, por exemplo). So https, e com
-- teto: e um texto que o dono escreve e o cliente clica.
alter table public.orders
  add constraint orders_rastreio_url_formato
    check (
      rastreio_url is null
      or (rastreio_url ~ '^https://[^[:space:]]+$' and char_length(rastreio_url) <= 500)
    );

comment on column public.orders.rastreio_codigo is
  'Codigo do objeto nos Correios (AB123456789BR). Gravado por envia_pedido junto com o status enviado (#378).';
comment on column public.orders.rastreio_url is
  'Link de rastreio opcional, https. Gravado por envia_pedido (#378).';

-- Quem le: o dono do pedido. `authenticated` tem SELECT na tabela inteira de
-- `orders` desde a #18 (a RLS `orders_le_os_proprios` limita as linhas), e
-- coluna nova entra nesse grant. Nao ha nada aqui que a pessoa nao deva ver:
-- e o codigo do pacote dela. Quem escreve: ninguem alem do service_role —
-- `authenticated` nao tem UPDATE em `orders`. O teste
-- supabase/tests/rastreio.sql confere as duas coisas.

-- ---------------------------------------------------------------------------
-- 2. a porta do envio
-- ---------------------------------------------------------------------------

create function public.envia_pedido(
  p_order_id uuid,
  p_autor uuid,
  p_rastreio_codigo text,
  p_rastreio_url text default null,
  p_motivo text default null
)
returns table (de public.status_pedido, para public.status_pedido)
language plpgsql
-- INVOKER, como `muda_status_pedido`: quem chama e o service_role, que ja
-- escreve em `orders`.
security invoker
set search_path = ''
as $$
declare
  v_de public.status_pedido;
begin
  if p_autor is null then
    raise exception 'autor obrigatorio' using errcode = '22004';
  end if;
  if p_rastreio_codigo is null then
    raise exception 'codigo de rastreio obrigatorio' using errcode = '22004';
  end if;
  if p_motivo is not null and char_length(p_motivo) > 300 then
    raise exception 'motivo longo demais' using errcode = '22001';
  end if;
  -- O formato do codigo e da URL quem confere sao as constraints acima: o
  -- UPDATE abaixo falha com 23514 e a transacao volta inteira, status junto.

  -- Mesma trava de `muda_status_pedido`: dois cliques ao mesmo tempo nao
  -- aplicam duas transicoes a partir do mesmo estado.
  select o.status into v_de
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'pedido nao encontrado' using errcode = 'P0002';
  end if;

  -- So de `em_producao`, como na tabela de transicoes
  -- (lib/loja/status-do-pedido.ts).
  if v_de <> 'em_producao' then
    raise exception 'transicao nao permitida: % -> enviado', v_de
      using errcode = 'P0001';
  end if;

  perform set_config('app.autor', p_autor::text, true);
  perform set_config('app.motivo', coalesce(p_motivo, ''), true);

  update public.orders
  set status = 'enviado',
      rastreio_codigo = p_rastreio_codigo,
      rastreio_url = nullif(p_rastreio_url, '')
  where id = p_order_id;

  return query select v_de, 'enviado'::public.status_pedido;
end;
$$;

comment on function public.envia_pedido(uuid, uuid, text, text, text) is
  'Marca o pedido enviado com o codigo de rastreio, na mesma transacao, com autor na trilha. So service_role executa.';

-- Funcao nova nasce com EXECUTE para public. Sem isto, qualquer conta logada
-- marcaria pedido alheio como enviado, com o codigo que quisesse.
revoke all on function public.envia_pedido(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.envia_pedido(uuid, uuid, text, text, text)
  to service_role;
