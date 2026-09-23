-- Issue #18 — indice na FK `autor` de order_status_history.
--
-- Achado do advisor de performance. Nao e micro-otimizacao: `autor` tem
-- `on delete set null`, e sem indice cada exclusao de conta (#41) varre a
-- tabela inteira de historico para achar as linhas daquele usuario.
create index order_status_history_autor on public.order_status_history (autor)
  where autor is not null;
