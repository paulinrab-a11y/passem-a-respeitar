/**
 * A conta ainda nao tem senha que a pessoa conheca? (#389)
 *
 * A conta que nasce pelo codigo do e-mail (#387) fica com uma senha aleatoria
 * que so o servidor viu, por um instante. Para a pessoa, e uma conta sem
 * senha: "Trocar senha" pede a atual, e ela nao tem nenhuma.
 *
 * Quem marca e o servidor, em `app_metadata`, na mesma chamada da chave
 * secreta que poe a senha aleatoria (lib/conta/codigo.ts). `app_metadata` e o
 * unico lugar da conta que a pessoa nao escreve: `updateUser`, com a sessao
 * dela, so mexe em `user_metadata`. Por isso a marca e de confianca, e o
 * navegador nao consegue se dizer "sem senha" para pular a senha atual.
 *
 * O Supabase nao conta, pela API, se a conta tem senha: o hash nao sai de
 * la, e a identidade de e-mail e a mesma para quem entrou por senha e por
 * codigo. Sem a marca, a resposta e "tem senha" — o lado que pede a atual.
 *
 * Sai a marca quando a pessoa cria a senha (Seguranca) ou redefine pela
 * recuperacao.
 */
export const MARCA_SEM_SENHA = 'sem_senha';

export function contaSemSenha(
  usuario: { app_metadata?: Record<string, unknown> | null } | null | undefined
) {
  return usuario?.app_metadata?.[MARCA_SEM_SENHA] === true;
}
