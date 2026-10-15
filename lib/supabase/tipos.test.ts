import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Database, Tables } from './tipos';

// O arquivo e gerado por `npm run tipos:gerar` e conferido no job e2e (#320).
// Estes testes pegam o que da para pegar sem banco: o tsc confere os tipos e
// o Vitest confere a forma do arquivo.

describe('tipos gerados do supabase', () => {
  it('profiles tem termos_aceitos_em, que faltava na versao editada a mao', () => {
    type Perfil = Tables<'profiles'>;
    expectTypeOf<Perfil['termos_aceitos_em']>().toEqualTypeOf<string | null>();
    expectTypeOf<
      Database['public']['Tables']['profiles']['Update']['termos_aceitos_em']
    >().toEqualTypeOf<string | null | undefined>();
  });

  const fonte = readFileSync(new URL('./tipos.ts', import.meta.url), 'utf8');

  it('comeca pelo aviso de arquivo gerado e diz como regenerar', () => {
    expect(fonte.startsWith('// GERADO A PARTIR DO SCHEMA.')).toBe(true);
    expect(fonte).toContain('npm run tipos:gerar');
  });

  it('so traz o schema public', () => {
    expect(fonte).not.toContain('graphql_public');
  });
});
