import { describe, expect, it } from 'vitest';
import { esquemaCriarConta, esquemaEmail, esquemaEntrar, esquemaRedefinirSenha } from './esquemas';

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

describe('esquemaCriarConta (#30)', () => {
  const bom = {
    nome: 'Fulana',
    email: 'Fulana@Exemplo.test ',
    senha: 'uma senha razoavel',
    confirmacao: 'uma senha razoavel',
    aceite: true,
  };

  it('aceita o cadastro completo e normaliza o e-mail', () => {
    const r = esquemaCriarConta.safeParse(bom);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe('fulana@exemplo.test');
  });

  // A caixa desmarcada nao e "false": e recusa.
  it.each([false, undefined, 'on', 'true', 1])('aceite %s nao passa', (aceite) => {
    expect(esquemaCriarConta.safeParse({ ...bom, aceite }).success).toBe(false);
  });

  it('confirmacao diferente cai no campo confirmacao', () => {
    const r = esquemaCriarConta.safeParse({ ...bom, confirmacao: 'outra' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['confirmacao']);
  });

  it('senha curta nao passa', () => {
    expect(
      esquemaCriarConta.safeParse({ ...bom, senha: '1234567', confirmacao: '1234567' }).success
    ).toBe(false);
  });

  it('nome de uma letra nao passa; 80 passa; 81 nao', () => {
    expect(esquemaCriarConta.safeParse({ ...bom, nome: 'A' }).success).toBe(false);
    expect(esquemaCriarConta.safeParse({ ...bom, nome: 'A'.repeat(80) }).success).toBe(true);
    expect(esquemaCriarConta.safeParse({ ...bom, nome: 'A'.repeat(81) }).success).toBe(false);
  });

  // Anti mass assignment: campo a mais nao vira propriedade.
  it('descarta campo que nao esta no schema', () => {
    const r = esquemaCriarConta.safeParse({ ...bom, admin: true, role: 'admin' });
    expect(r.success).toBe(true);
    if (r.success)
      expect(Object.keys(r.data).sort()).toEqual([
        'aceite',
        'confirmacao',
        'email',
        'nome',
        'senha',
      ]);
  });
});

describe('esquemaEmail e esquemaRedefinirSenha (#32)', () => {
  it('normaliza o e-mail', () => {
    const r = esquemaEmail.safeParse({ email: ' Alguem@Exemplo.test' });
    expect(r.success && r.data.email).toBe('alguem@exemplo.test');
  });

  it('recusa o que nao e e-mail', () => {
    expect(esquemaEmail.safeParse({ email: 'nao-e' }).success).toBe(false);
  });

  it('redefinir exige minimo e confirmacao igual', () => {
    expect(esquemaRedefinirSenha.safeParse({ nova: 'curta', confirmacao: 'curta' }).success).toBe(
      false
    );
    expect(
      esquemaRedefinirSenha.safeParse({ nova: 'senha nova boa', confirmacao: 'x' }).success
    ).toBe(false);
    expect(
      esquemaRedefinirSenha.safeParse({ nova: 'senha nova boa', confirmacao: 'senha nova boa' })
        .success
    ).toBe(true);
  });
});
