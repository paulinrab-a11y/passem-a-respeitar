-- Issue #187: a camiseta e so da CBAC.
--
-- Ela nasceu no catalogo como "Camiseta CBAC x Passem a Respeitar", com a
-- descricao terminando em "Edição do EP." (migration 20260924100000). Nao e
-- colab: e uma camiseta da CBAC, vendida no site do EP. Decisao do dono em
-- 29/09/2026.
--
-- O slug nao muda. Ele e identificador: esta em link de checkout e em item
-- de pedido.
--
-- Os dois `update` so mexem no texto que ainda e o do seed. Se alguem ja
-- tiver ajustado nome ou descricao pelo banco, o ajuste fica.
--
-- Item de pedido guarda o nome de quando a compra foi feita, e isso tambem
-- fica: pedido e registro, e registro nao se reescreve.

update public.produtos
set nome = 'Camiseta CBAC'
where slug = 'camiseta-cbac'
  and nome = 'Camiseta CBAC x Passem a Respeitar';

update public.produtos
set descricao = 'Preta, oversized, estampa branca do brasão CBAC no peito.'
where slug = 'camiseta-cbac'
  and descricao = 'Preta, oversized, estampa branca do brasão CBAC no peito. Edição do EP.';
