-- Issue #102 — as barreiras do eixo financeiro e do endereco.
--
-- Como rodar: cole no SQL Editor do Supabase. Nao cria nem apaga nada; so
-- tenta, e espera ser barrado em todas.
--
-- O papel e `authenticated` porque `anon` nem GRANT tem — o caso interessante
-- e a pessoa logada, que tem sessao valida e quer usar isso para marcar o
-- proprio pedido como pago.

create temp table r (caso text, esperado text, obtido text);
grant all on r to anon, authenticated;

do $$ begin
  set local role authenticated;

  -- --- leitura: so as colunas de exibicao ---------------------------------

  -- A chave de idempotencia garante que a cobranca nao duplica. Quem a conhece
  -- pode tentar interferir numa retentativa.
  begin
    perform idempotency_key from public.pagamentos limit 1;
    insert into r values ('le idempotency_key', 'permission denied', 'LEU');
  exception when insufficient_privilege then
    insert into r values ('le idempotency_key', 'permission denied', 'permission denied');
  end;

  begin
    perform provedor_pagamento_id from public.pagamentos limit 1;
    insert into r values ('le id do provedor', 'permission denied', 'LEU');
  exception when insufficient_privilege then
    insert into r values ('le id do provedor', 'permission denied', 'permission denied');
  end;

  begin
    perform provedor_status from public.pagamentos limit 1;
    insert into r values ('le status cru do provedor', 'permission denied', 'LEU');
  exception when insufficient_privilege then
    insert into r values ('le status cru do provedor', 'permission denied', 'permission denied');
  end;

  -- Auditoria de servidor: sem GRANT e sem policy, invisivel duas vezes.
  begin
    perform 1 from public.pagamento_eventos limit 1;
    insert into r values ('le pagamento_eventos', 'permission denied', 'LEU');
  exception when insufficient_privilege then
    insert into r values ('le pagamento_eventos', 'permission denied', 'permission denied');
  end;

  -- --- escrita: nenhuma ----------------------------------------------------

  -- O teste do "pagamento falso": a pessoa logada tentando se declarar paga.
  begin
    update public.pagamentos set estado = 'aprovado';
    insert into r values ('marca pagamento como aprovado', 'permission denied', 'MARCOU');
  exception
    when insufficient_privilege then
      insert into r values ('marca pagamento como aprovado', 'permission denied', 'permission denied');
    when others then
      insert into r values ('marca pagamento como aprovado', 'permission denied', sqlstate);
  end;

  begin
    insert into public.pagamentos (order_id, tentativa, valor_centavos)
    values (gen_random_uuid(), 1, 1);
    insert into r values ('cria pagamento', 'permission denied', 'CRIOU');
  exception
    when insufficient_privilege then
      insert into r values ('cria pagamento', 'permission denied', 'permission denied');
    when others then
      insert into r values ('cria pagamento', 'permission denied', sqlstate);
  end;

  -- Forjar evento de webhook seria forjar a confirmacao financeira.
  begin
    insert into public.pagamento_eventos (evento_id) values ('falso');
    insert into r values ('forja evento de webhook', 'permission denied', 'FORJOU');
  exception
    when insufficient_privilege then
      insert into r values ('forja evento de webhook', 'permission denied', 'permission denied');
    when others then
      insert into r values ('forja evento de webhook', 'permission denied', sqlstate);
  end;

  -- Endereco e snapshot: trocar depois mudaria para onde um pedido ja pago vai.
  begin
    update public.orders set entrega_uf = 'RJ';
    insert into r values ('muda endereco do pedido', 'permission denied', 'MUDOU');
  exception
    when insufficient_privilege then
      insert into r values ('muda endereco do pedido', 'permission denied', 'permission denied');
    when others then
      insert into r values ('muda endereco do pedido', 'permission denied', sqlstate);
  end;

  reset role;
end $$;

select caso, esperado, obtido,
       case when esperado = obtido then 'OK' else 'FALHOU' end as veredito
from r;
