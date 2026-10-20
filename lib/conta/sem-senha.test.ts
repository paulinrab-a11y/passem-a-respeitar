import { describe, expect, it } from 'vitest';
import { contaSemSenha } from './sem-senha';

describe('contaSemSenha (#389)', () => {
  it('so a marca true do servidor diz que a conta nao tem senha', () => {
    expect(contaSemSenha({ app_metadata: { sem_senha: true } })).toBe(true);
  });

  it.each([
    ['sem usuario', null],
    ['sem app_metadata', {}],
    ['sem a marca', { app_metadata: { provider: 'email' } }],
    ['marca apagada', { app_metadata: { sem_senha: null } }],
    ['texto no lugar do booleano', { app_metadata: { sem_senha: 'true' } }],
  ])('%s: tem senha, e a troca pede a atual', (_, usuario) => {
    expect(contaSemSenha(usuario)).toBe(false);
  });
});
