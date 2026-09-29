/**
 * O endereco de contato do site (Issue #183).
 *
 * E o que aparece na politica de privacidade e no rodape dos e-mails de
 * conta. Hoje e o mesmo endereco que envia esses e-mails pelo Mailjet; troca
 * pelo do dominio quando ele existir (#54).
 *
 * Os e-mails nao importam daqui: os modelos ficam em
 * supabase/templates/modelos.mjs, que nao le TypeScript. O teste confere que
 * os dois lugares dizem o mesmo endereco.
 */
export const CONTATO = 'atendimento.paulinrabelo@gmail.com';
