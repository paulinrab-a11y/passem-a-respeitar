/**
 * Cada arquivo de teste e um visitante, com o IP dele.
 *
 * O site limita tentativas por IP: vinte logins a cada quinze minutos, cinco
 * cadastros por hora. A suite inteira saindo de um IP so e UM visitante
 * fazendo tudo, e a soma dos logins dos arquivos passava do limite — o ultimo
 * arquivo a rodar falhava por causa dos anteriores, e qual era o ultimo
 * dependia da ordem alfabetica.
 *
 * O limite em si nao e testado aqui: tem teste de unidade, e o que ele conta
 * e a chave que recebe. Aqui so se evita que um teste reprove por culpa de
 * outro.
 *
 * Os enderecos sao da faixa 203.0.113.0/24, reservada para documentacao
 * (RFC 5737): nao sao de ninguem. Em producao este cabecalho nao engana o
 * site: a Vercel o reescreve com o IP de verdade antes de o pedido chegar.
 */
const ARQUIVOS = [
  'acessibilidade',
  'admin',
  'cadastro',
  'emails',
  'home',
  'login',
  'nao-encontrada',
  'pedidos',
  'senha',
] as const;

export function visitante(arquivo: (typeof ARQUIVOS)[number]) {
  return { 'x-forwarded-for': `203.0.113.${ARQUIVOS.indexOf(arquivo) + 10}` };
}
