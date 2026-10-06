-- Issue #206 — guia de tamanhos do produto.
--
-- Camiseta e o produto que mais volta por tamanho, e devolucao custa frete
-- duas vezes. A tabela de medidas mora no banco, junto do nome e da descricao:
-- e informacao do produto, e o catalogo e a fonte de verdade dele (#99).
--
-- Uma lista de linhas, uma por tamanho, em centimetros:
--   [{ "tamanho": "P", "altura": 79, "largura": 67, "manga": 23 }, ...]
-- Nula para produto sem guia (adesivo, poster): a tela nao mostra o link.

alter table public.produtos
  add column guia_tamanhos jsonb
    check (guia_tamanhos is null or jsonb_typeof(guia_tamanhos) = 'array');

comment on column public.produtos.guia_tamanhos is
  'Medidas por tamanho, em cm: [{tamanho, altura, largura, manga}]. Nulo: sem guia.';

-- Leitura publica, como o resto da ficha. Escrita continua so do service_role.
grant select (guia_tamanhos) on public.produtos to anon, authenticated;

-- A tabela da Mikonos, distribuidora, para a oversized (lida em 06/10/2026 na
-- loja deles). Altura e largura da peca; manga e o comprimento da manga.
-- `where guia_tamanhos is null`: se alguem ja tiver gravado uma, ela fica.
update public.produtos
set guia_tamanhos = '[
  { "tamanho": "P",  "altura": 79, "largura": 67, "manga": 23 },
  { "tamanho": "M",  "altura": 80, "largura": 69, "manga": 24 },
  { "tamanho": "G",  "altura": 82, "largura": 72, "manga": 25 },
  { "tamanho": "GG", "altura": 84, "largura": 74, "manga": 26 }
]'::jsonb
where slug = 'camiseta-cbac'
  and guia_tamanhos is null;
