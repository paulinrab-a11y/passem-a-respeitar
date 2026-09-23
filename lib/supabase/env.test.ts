import { afterEach, describe, expect, it, vi } from 'vitest';

// env.ts le o ambiente no import, entao cada caso precisa de um modulo novo.
// `resetModules` limpa o cache do Vitest para que o import volte a rodar.
async function importaEnv() {
  vi.resetModules();
  return import('./env');
}

const URL_FALSA = 'https://projeto-de-teste.supabase.co';
const CHAVE_FALSA = 'sb_publishable_chave_de_teste';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('env do Supabase', () => {
  it('le as duas variaveis quando existem', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', URL_FALSA);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', CHAVE_FALSA);

    const env = await importaEnv();
    expect(env.SUPABASE_URL).toBe(URL_FALSA);
    expect(env.SUPABASE_PUBLISHABLE_KEY).toBe(CHAVE_FALSA);
  });

  // Falha fechada, e com o nome da variavel no erro. A alternativa comum,
  // `process.env.X!`, entrega undefined adiante e o erro aparece tres camadas
  // depois como "Invalid API key", que nao aponta para nada.
  it('explode citando a variavel que falta', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', CHAVE_FALSA);

    await expect(importaEnv()).rejects.toThrow('NEXT_PUBLIC_SUPABASE_URL');
  });

  it('explode tambem quando falta a chave publishable', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', URL_FALSA);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');

    await expect(importaEnv()).rejects.toThrow('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  });

  it('diz como resolver', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    await expect(importaEnv()).rejects.toThrow(/vercel env pull/);
  });
});
