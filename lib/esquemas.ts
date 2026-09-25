import { z } from 'zod';
import { SENHA_MAX, SENHA_MIN } from './conta/senha';

/**
 * Schemas de entrada. Tudo que chega de formulario passa por aqui antes de
 * chegar no Supabase.
 *
 * O ganho nao e "validar o e-mail": e a lista de campos ser fechada. `parse`
 * devolve so o que esta descrito no schema, entao um campo a mais no POST nao
 * vira propriedade no objeto que segue adiante. Isso e o anti mass assignment
 * da Issue #19 na forma mais barata que existe.
 */

export const esquemaEntrar = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(254) // RFC 5321
    .email(),
  senha: z.string().min(1).max(SENHA_MAX),
  // Checkbox nao enviado nao aparece no FormData; por isso o default.
  lembrar: z.boolean().default(false),
});

/**
 * Nome de exibicao. O limite de 80 bate com o check constraint da tabela
 * (migration 20260923120000) — se divergissem, o banco recusaria depois de o
 * formulario ter dito que estava tudo certo.
 */
export const esquemaNome = z.object({
  nome: z.string().trim().min(2).max(80),
});

/**
 * Troca de senha. O minimo de 8 e a Issue #25; o teto e para nao mandar um
 * megabyte de texto ao bcrypt.
 *
 * A confirmacao e conferida aqui, e nao so no cliente: o formulario e HTML, e
 * qualquer um monta um POST sem ela.
 */
export const esquemaTrocarSenha = z
  .object({
    atual: z.string().min(1).max(SENHA_MAX),
    nova: z.string().min(SENHA_MIN).max(SENHA_MAX),
    confirmacao: z.string().min(1).max(SENHA_MAX),
  })
  .refine((d) => d.nova === d.confirmacao, { path: ['confirmacao'] })
  // Trocar a senha pela mesma senha nao e troca; e a pessoa achando que fez
  // algo enquanto a senha comprometida continua valendo.
  .refine((d) => d.nova !== d.atual, { path: ['nova'] });

/**
 * Cadastro (Issue #30).
 *
 * O aceite e `z.literal(true)`, nao `boolean`: a caixa desmarcada nao e
 * "false", e recusa. E conferido aqui, no servidor, porque o `required` do
 * HTML e sugestao — qualquer um monta o POST sem ele.
 *
 * A senha e so tamanho neste ponto; vazamento e checado depois, em
 * senha-servidor.ts, porque e uma ida a rede e nao cabe num schema.
 */
export const esquemaCriarConta = z
  .object({
    nome: z.string().trim().min(2).max(80),
    email: z.string().trim().toLowerCase().min(1).max(254).email(),
    senha: z.string().min(SENHA_MIN).max(SENHA_MAX),
    confirmacao: z.string().min(1).max(SENHA_MAX),
    aceite: z.literal(true),
  })
  .refine((d) => d.senha === d.confirmacao, { path: ['confirmacao'] });

/** Pedido de recuperacao (#32): so o e-mail, normalizado como no login. */
export const esquemaEmail = z.object({
  email: z.string().trim().toLowerCase().min(1).max(254).email(),
});

/** Redefinicao (#32): nova senha e confirmacao. A sessao de recuperacao ja provou quem e. */
export const esquemaRedefinirSenha = z
  .object({
    nova: z.string().min(SENHA_MIN).max(SENHA_MAX),
    confirmacao: z.string().min(1).max(SENHA_MAX),
  })
  .refine((d) => d.nova === d.confirmacao, { path: ['confirmacao'] });
