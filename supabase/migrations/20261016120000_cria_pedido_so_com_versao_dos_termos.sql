-- Issue #391 — a `cria_pedido` de 6 parametros sai (limpeza da #380).
--
-- A migration 20261015200000 criou a `cria_pedido` de 7 parametros, com a
-- versao dos termos, e deixou a de 6 viva so para o codigo que estava em
-- producao ate o deploy. O codigo novo esta no ar: lib/loja/pedido.ts manda
-- `p_termos_versao`, e o PostgREST escolhe a de 7 pelo nome dos argumentos.
-- Ninguem mais chama a de 6.
--
-- Deixa-la seria manter um caminho que cria pedido sem a versao dos termos.
-- O teste supabase/tests/cria-pedido.sql volta a exigir uma funcao so.

drop function public.cria_pedido(uuid, integer, jsonb, jsonb, jsonb, timestamptz);
