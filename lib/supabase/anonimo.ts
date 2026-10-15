// Client anonimo de servidor: chave publishable, sem cookie, sem sessao (#374).
//
// Para leitura publica que pode ser compartilhada entre requests, como o
// catalogo da home. O client com cookies (servidor.ts) amarra a leitura a quem
// pediu e nao pode entrar num cache compartilhado; este nao carrega ninguem.
//
// O que ele alcanca e o que o papel `anon` alcanca: a RLS e o GRANT por coluna
// valem igual. Nenhum poder a mais que o navegador de um visitante sem login.

import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './env';
import type { Database } from './tipos';

export function clienteAnonimo() {
  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
