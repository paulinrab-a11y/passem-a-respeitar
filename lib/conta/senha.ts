/**
 * Regras de senha que valem nos dois lados (Issue #25).
 *
 * Sem `server-only`: o medidor de forca roda no navegador enquanto a pessoa
 * digita. O que decide de verdade fica em `senha-servidor.ts`.
 */

export const SENHA_MIN = 8;
export const SENHA_MAX = 200;

/**
 * Teto alto de proposito. Nao e para "senha comprida demais" — e para nao
 * mandar um megabyte de texto para o bcrypt.
 *
 * O minimo e 8 porque e o que a Issue pede. Vale dizer o que ele nao e: 8
 * caracteres nao e uma senha boa, e nenhuma regra de "uma maiuscula, um
 * numero, um simbolo" conserta isso. O que separa senha boa de ruim e
 * comprimento e nao ser reaproveitada — por isso a checagem contra vazamento
 * pesa mais aqui do que qualquer exigencia de simbolo.
 */

const SEQUENCIAS = ['123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl'];

/** Padroes que aparecem em toda lista de senha vazada. */
const OBVIAS = [
  'senha',
  'password',
  'passem',
  'respeitar',
  'santxx',
  'ch3fe',
  'whynot',
  'admin',
  'brasil',
  '1234',
];

export type Forca = {
  /** 0 a 4. */
  nivel: number;
  rotulo: string;
};

/**
 * Medidor para o navegador.
 *
 * E orientacao, nao veredito: quem recusa e o servidor. Nao uso zxcvbn porque
 * sao ~400KB de dicionario num site que ja carrega three.js e um modelo 3D,
 * para um campo que a pessoa preenche uma vez na vida.
 *
 * A pontuacao e dominada por comprimento, que e o que de fato importa. O
 * resto so desconta.
 */
export function forcaDaSenha(senha: string): Forca {
  if (senha.length === 0) return { nivel: 0, rotulo: '' };
  if (senha.length < SENHA_MIN) return { nivel: 0, rotulo: 'curta demais' };

  let pontos = 0;

  // Comprimento: o que realmente move a agulha.
  if (senha.length >= 10) pontos += 1;
  if (senha.length >= 14) pontos += 1;
  if (senha.length >= 20) pontos += 1;

  // Variedade vale um ponto no total, nao um por tipo: "Senha1!" tem quatro
  // tipos e e pessima.
  const tipos = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((r) => r.test(senha)).length;
  if (tipos >= 3) pontos += 1;

  const minuscula = senha.toLowerCase();

  if (OBVIAS.some((p) => minuscula.includes(p))) pontos -= 2;
  if (/^(.)\1+$/.test(senha)) pontos -= 2;
  if (SEQUENCIAS.some((s) => temTrechoDe(s, minuscula, 4))) pontos -= 1;

  const nivel = Math.max(0, Math.min(4, pontos));
  return { nivel, rotulo: ['fraca', 'fraca', 'razoável', 'boa', 'forte'][nivel] };
}

/** `abcd` dentro de `abcdefgh...`, em qualquer direcao. */
function temTrechoDe(fonte: string, alvo: string, tamanho: number) {
  const invertida = [...fonte].reverse().join('');

  for (let i = 0; i + tamanho <= fonte.length; i++) {
    const trecho = fonte.slice(i, i + tamanho);
    if (alvo.includes(trecho)) return true;
  }
  for (let i = 0; i + tamanho <= invertida.length; i++) {
    if (alvo.includes(invertida.slice(i, i + tamanho))) return true;
  }
  return false;
}
