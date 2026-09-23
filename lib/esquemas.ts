import { z } from 'zod';

/**
 * Schemas de entrada. Tudo que chega de formulario passa por aqui antes de
 * chegar no Supabase.
 *
 * O ganho nao e "validar o e-mail": e a lista de campos ser fechada. `parse`
 * devolve so o que esta descrito no schema, entao um campo a mais no POST nao
 * vira propriedade no objeto que segue adiante. Isso e o anti mass assignment
 * da Issue #19 na forma mais barata que existe.
 */

/**
 * Limite alto de proposito. Nao e regra de senha — isso e a Issue #25, e vale
 * no cadastro. No login, recusar por tamanho seria contar ao atacante qual e a
 * regra de senha do site. O que ha aqui e teto contra corpo gigante.
 */
const SENHA_MAX = 200;

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
