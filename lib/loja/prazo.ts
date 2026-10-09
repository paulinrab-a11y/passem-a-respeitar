/**
 * Quanto a camiseta leva para ser fabricada depois do pedido (#197).
 *
 * Mora aqui, e nao em cada texto, porque o numero aparece na ficha da home, na
 * ficha da loja, no checkout e no prompt do concierge (#278). Escrito a mao em
 * cinco lugares, bastava o dono mudar um para o site prometer dois prazos na
 * mesma visita. Sem `server-only`: o checkout le isto num componente cliente.
 */
export const PRAZO_DE_PRODUCAO_DIAS = 30;
