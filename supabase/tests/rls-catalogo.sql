-- Issue #99 — as barreiras do catalogo, conferidas rodando como `anon`.
--
-- Como rodar: cole no SQL Editor do Supabase. O bloco inteiro nao muda nada em
-- definitivo — o que ele desativa, ele reativa no fim.
--
-- O papel e `anon` de proposito: e o pior caso. Se `anon` nao escreve preco,
-- `authenticated` tambem nao, porque os dois recebem exatamente o mesmo GRANT.

create temp table resultado (caso text, esperado text, obtido text);

-- O harness roda como `authenticated`; sem isto o insert no temp falha com
-- "permission denied for table resultado" no meio do primeiro bloco.
grant all on resultado to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Leitura: o que a vitrine precisa, e so
-- ---------------------------------------------------------------------------

do $$ begin
  set local role anon;
  insert into resultado values ('anon le produto ativo', '1',
    (select count(*)::text from public.produtos where slug = 'camiseta-cbac'));
  insert into resultado values ('anon le as variacoes', '4',
    (select count(*)::text from public.produto_variacoes));
  reset role;
end $$;

-- `estoque` nao foi concedido. Quantas pecas restam e informacao do negocio:
-- "so restam 2" e sinal que concorrente e cambista usam.
do $$ begin
  set local role anon;
  begin
    perform estoque from public.produto_variacoes limit 1;
    insert into resultado values ('anon le estoque', 'permission denied', 'LEU');
  exception when insufficient_privilege then
    insert into resultado values ('anon le estoque', 'permission denied', 'permission denied');
  end;
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Escrita: nenhuma
-- ---------------------------------------------------------------------------

do $$ begin
  set local role anon;
  begin
    update public.produto_variacoes set preco_centavos = 1;
    insert into resultado values ('anon muda preco', 'permission denied', 'MUDOU');
  exception
    when insufficient_privilege then
      insert into resultado values ('anon muda preco', 'permission denied', 'permission denied');
    when others then
      insert into resultado values ('anon muda preco', 'permission denied', sqlstate);
  end;
  reset role;
end $$;

do $$ begin
  set local role anon;
  begin
    insert into public.produtos (slug, nome) values ('pirata', 'Produto de graca');
    insert into resultado values ('anon cria produto', 'permission denied', 'CRIOU');
  exception
    when insufficient_privilege then
      insert into resultado values ('anon cria produto', 'permission denied', 'permission denied');
    when others then
      insert into resultado values ('anon cria produto', 'permission denied', sqlstate);
  end;
  reset role;
end $$;

do $$ begin
  set local role anon;
  begin
    delete from public.produtos;
    insert into resultado values ('anon apaga produto', 'permission denied', 'APAGOU');
  exception
    when insufficient_privilege then
      insert into resultado values ('anon apaga produto', 'permission denied', 'permission denied');
    when others then
      insert into resultado values ('anon apaga produto', 'permission denied', sqlstate);
  end;
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- RLS: desativar tira da vitrine, e leva as variacoes junto
-- ---------------------------------------------------------------------------

update public.produtos set ativo = false where slug = 'camiseta-cbac';

do $$ begin
  set local role anon;
  insert into resultado values ('produto desativado some', '0',
    (select count(*)::text from public.produtos where slug = 'camiseta-cbac'));
  -- A policy da variacao tem um `exists` sobre produtos que roda como invoker,
  -- entao a policy de produtos se aplica dentro dele. Desativar o pai esconde
  -- os filhos sem precisar desativar um por um.
  insert into resultado values ('variacoes somem junto', '0',
    (select count(*)::text from public.produto_variacoes));
  reset role;
end $$;

update public.produtos set ativo = true where slug = 'camiseta-cbac';
update public.produto_variacoes set ativo = false where tamanho = 'GG';

do $$ begin
  set local role anon;
  insert into resultado values ('produto continua visivel', '1',
    (select count(*)::text from public.produtos where slug = 'camiseta-cbac'));
  insert into resultado values ('so a variacao GG some', '3',
    (select count(*)::text from public.produto_variacoes));
  reset role;
end $$;

update public.produto_variacoes set ativo = true where tamanho = 'GG';

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------

do $$ begin
  begin
    insert into public.produto_variacoes (produto_id, tamanho, preco_centavos)
    select id, 'P', 0 from public.produtos where slug = 'camiseta-cbac';
    insert into resultado values ('preco zero no banco', 'check_violation', 'ACEITOU');
  exception when check_violation then
    insert into resultado values ('preco zero no banco', 'check_violation', 'check_violation');
  end;
end $$;

do $$ begin
  begin
    insert into public.produto_variacoes (produto_id, tamanho, preco_centavos)
    select id, 'M', 9900 from public.produtos where slug = 'camiseta-cbac';
    insert into resultado values ('tamanho repetido', 'unique_violation', 'ACEITOU');
  exception when unique_violation then
    insert into resultado values ('tamanho repetido', 'unique_violation', 'unique_violation');
  end;
end $$;

select caso, esperado, obtido,
       case when esperado = obtido then 'OK' else 'FALHOU' end as veredito
from resultado;
