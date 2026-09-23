import { describe, expect, it } from 'vitest';
import { esquemaEntrar } from './esquemas';

const valido = { email: 'pessoa@exemplo.com', senha: 'senha-qualquer', lembrar: false };

describe('esquemaEntrar', () => {
  it('aceita entrada valida', () => {
    expect(esquemaEntrar.safeParse(valido).success).toBe(true);
  });

  it('normaliza o e-mail', () => {
    const r = esquemaEntrar.parse({ ...valido, email: '  Pessoa@Exemplo.COM  ' });
    expect(r.email).toBe('pessoa@exemplo.com');
  });

  // O e-mail vira chave de rate limit. Sem normalizar, `A@x.com` e `a@x.com`
  // seriam baldes diferentes e o limite por conta cairia pela metade a cada
  // variacao de caixa que o atacante inventasse.
  it('a normalizacao e o que faz o limite por e-mail valer', () => {
    const a = esquemaEntrar.parse({ ...valido, email: 'Alvo@Exemplo.com' });
    const b = esquemaEntrar.parse({ ...valido, email: 'alvo@exemplo.com  ' });
    expect(a.email).toBe(b.email);
  });

  it.each([
    ['sem arroba', 'pessoa.exemplo.com'],
    ['vazio', ''],
    ['so espaco', '   '],
    ['muito longo', `${'a'.repeat(250)}@exemplo.com`],
  ])('recusa e-mail %s', (_nome, email) => {
    expect(esquemaEntrar.safeParse({ ...valido, email }).success).toBe(false);
  });

  it('recusa senha vazia', () => {
    expect(esquemaEntrar.safeParse({ ...valido, senha: '' }).success).toBe(false);
  });

  it('recusa senha gigante', () => {
    expect(esquemaEntrar.safeParse({ ...valido, senha: 'a'.repeat(201) }).success).toBe(false);
  });

  // Nao e regra de senha: isso e a #25, e vale no cadastro. Recusar senha
  // curta no login contaria ao atacante qual e a regra do site.
  it('aceita senha curta, porque login nao julga forca', () => {
    expect(esquemaEntrar.safeParse({ ...valido, senha: 'a' }).success).toBe(true);
  });

  it('lembrar cai em false quando nao vem', () => {
    const r = esquemaEntrar.parse({ email: valido.email, senha: valido.senha });
    expect(r.lembrar).toBe(false);
  });

  // O ponto do schema nao e validar: e a lista de campos ser fechada. Campo a
  // mais no POST nao pode virar propriedade no objeto que segue adiante.
  it('descarta campo que nao esta no schema', () => {
    const r = esquemaEntrar.parse({ ...valido, admin: true, user_id: 'outro' }) as Record<
      string,
      unknown
    >;

    expect(Object.keys(r).sort()).toEqual(['email', 'lembrar', 'senha']);
    expect(r.admin).toBeUndefined();
  });
});
