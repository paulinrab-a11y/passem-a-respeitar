-- Issue #199 — peso e medidas da camiseta, para o frete.
--
-- Decisao do dono em 02/10/2026. A camiseta vai dobrada num saco de envio
-- preto, sem caixa.
--
--   peso    400 g   o cadastro da Mikonos, o distribuidor, para o frete da
--                   loja deles. Bate com a conta: malha de 240 g/m2, GG de
--                   84 x 74 cm, mais estampa e saco.
--   medidas 32 x 40 x 4 cm   um saco de envio comum para camiseta oversized,
--                   com a camiseta dobrada dentro. O cadastro da Mikonos diz
--                   10 x 10 x 5, que nao e o tamanho de um saco com uma
--                   oversized dentro.
--
-- Os Correios so cobram pelo tamanho quando o peso cubico (C x L x A / 6000)
-- passa de 5 kg. Uma camiseta neste saco fica em 0,85 kg cubico: quem decide o
-- preco e o peso. As medidas existem porque o calculo pede, e para nao ser
-- numero inventado.
--
-- `where peso_gramas is null`: se alguem ja tiver gravado a medida de verdade,
-- ela fica.

update public.produtos
set
  peso_gramas = 400,
  altura_cm = 4,
  largura_cm = 32,
  comprimento_cm = 40
where slug = 'camiseta-cbac'
  and peso_gramas is null;
