/**
 * Estado do formulario de login.
 *
 * Mora fora de `acoes.ts` por uma regra do Next que nao aparece no build:
 * arquivo com `'use server'` so pode exportar funcao async. Exportar este
 * objeto de la derruba a pagina em runtime com
 * "A 'use server' file can only export async functions, found object" —
 * e lint, typecheck, teste e `next build` passam todos verdes antes disso.
 */
export type EstadoEntrar = {
  erro: string | null;
  /**
   * O que o erro aponta, para o `aria-invalid` (#51). `credenciais` marca
   * e-mail E senha, juntos: o erro de login nao diz qual dos dois esta errado,
   * e a marcacao tambem nao pode dizer. Limite de tentativas nao aponta campo.
   */
  campo: 'credenciais' | null;
  /**
   * Contador de envios. Vira `key` do paragrafo de erro no formulario, e e o
   * que faz a mensagem reanimar quando o erro se repete — sem isso, errar a
   * senha duas vezes deixaria o texto parado e a pessoa nao saberia se o
   * segundo envio chegou a acontecer.
   *
   * Contador e nao `Date.now()`: dois envios no mesmo milissegundo dariam a
   * mesma chave. Improvavel com uma ida ao servidor no meio, mas depender do
   * relogio para isso nao paga nada.
   */
  tentativa: number;
  /**
   * Senha certa de conta que nunca confirmou o e-mail (#260): o formulario da
   * lugar a tela do codigo, que precisa do e-mail e do "manter conectado"
   * escolhido aqui. Nunca preenchido com a senha errada.
   *
   * `enviado` diz se um codigo novo saiu agora. Falso quando a cota de envio
   * acabou ou o Supabase recusou: a tela muda o texto em vez de prometer um
   * e-mail que nao vai chegar.
   */
  confirmar?: { email: string; lembrar: boolean; enviado: boolean };
};

export const estadoInicial: EstadoEntrar = { erro: null, campo: null, tentativa: 0 };
