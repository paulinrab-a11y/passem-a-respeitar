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
 * A senha escolhida no cadastro e a confirmacao dela. Fora dos schemas
 * porque ela passa por duas portas: o cadastro (#30) e, de novo, a
 * confirmacao pelo codigo, que grava essa senha na conta (#284). As duas
 * conferem com as mesmas regras — a senha que o codigo grava e uma que o
 * cadastro teria aceitado.
 */
const senhaEscolhida = {
  senha: z.string().min(SENHA_MIN).max(SENHA_MAX),
  confirmacao: z.string().min(1).max(SENHA_MAX),
};

const confirmacaoBate = (d: { senha: string; confirmacao: string }) => d.senha === d.confirmacao;

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
// Sem nome (#207): e-mail, senha e aceite bastam para comprar. Quem quiser
// poe o nome depois, em Conta — o perfil nasce sem ele e a tela sabe disso.
export const esquemaCriarConta = z
  .object({
    email: z.string().trim().toLowerCase().min(1).max(254).email(),
    ...senhaEscolhida,
    aceite: z.literal(true),
  })
  .refine(confirmacaoBate, { path: ['confirmacao'] });

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

/**
 * Troca de e-mail (#36): o endereco novo, normalizado como no login, e a senha
 * de agora. A senha e a reautenticacao: conferida no instante do pedido.
 */
export const esquemaTrocarEmail = z.object({
  email: z.string().trim().toLowerCase().min(1).max(254).email(),
  senha: z.string().min(1).max(SENHA_MAX),
});

/** O que o Concierge aceita em uma pergunta (#191). */
export const CONCIERGE_MENSAGEM_MAX = 500;
/** Quantas trocas anteriores o navegador pode mandar junto. */
export const CONCIERGE_HISTORICO_MAX = 8;
const CONCIERGE_TROCA_MAX = 1000;

/**
 * Concierge (#191): a pergunta e as ultimas trocas, vindas do navegador.
 *
 * O historico e do cliente e vale o que vale: entra no prompt como contexto,
 * nao como fato. Por isso o teto curto em quantidade e em tamanho — e por
 * isso `papel` e um enum fechado: qualquer outro valor nao vira "system" por
 * acidente.
 */
export const esquemaConcierge = z.object({
  mensagem: z.string().trim().min(1).max(CONCIERGE_MENSAGEM_MAX),
  historico: z
    .array(
      z.object({
        papel: z.enum(['usuario', 'concierge']),
        texto: z.string().max(CONCIERGE_TROCA_MAX),
      })
    )
    .max(CONCIERGE_HISTORICO_MAX)
    .default([]),
});

/**
 * Comprimento do codigo de confirmacao (#224). E uma configuracao do projeto
 * no Supabase (Authentication > Sign In / Providers > Email > "Email OTP
 * length"): producao esta em 8, e o config.toml local acompanha. Mudar la sem
 * mudar aqui faz o campo recusar o codigo que chegou — foi o que aconteceu em
 * 06/10/2026 com 6 aqui e 8 la.
 */
export const CODIGO_DIGITOS = 8;

/**
 * Codigo de confirmacao do cadastro (#224): so digitos, no comprimento certo.
 * Espacos e texto em volta (gente cola "Seu código: 1234 5678") sao tirados
 * ANTES, no campo; aqui chega o que o servidor aceita.
 */
export const esquemaCodigo = z.object({
  email: z.string().trim().toLowerCase().min(1).max(254).email(),
  codigo: z.string().regex(new RegExp(`^\\d{${CODIGO_DIGITOS}}$`)),
  // "Manter conectado" de quem chegou pelo login (#260). Do cadastro nao vem:
  // la a caixa nao existe, e sem ela vale o lado seguro.
  lembrar: z.boolean().default(false),
});

/**
 * O codigo da tela do cadastro, com a senha que a pessoa acabou de escolher
 * (#284). A senha volta porque o Supabase nao a grava quando o e-mail ja
 * tinha cadastro pendente: quem confirma pelo codigo grava a dele. Sem
 * `lembrar`: o cadastro nao tem a caixa.
 */
export const esquemaConfirmarCadastro = esquemaCodigo
  .pick({ email: true, codigo: true })
  .extend(senhaEscolhida)
  .refine(confirmacaoBate, { path: ['confirmacao'] });
