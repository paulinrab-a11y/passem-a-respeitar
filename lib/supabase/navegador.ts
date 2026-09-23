// Client do navegador. Usa a chave publishable e nada mais.
//
// Toda query daqui passa pela RLS: o usuario so alcanca a propria linha, e em
// orders, order_items e order_status_history ele so le — escrita nessas tres
// e recusada pelo banco antes de chegar na policy, por falta de GRANT.

import { createBrowserClient } from '@supabase/ssr';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './env';
import type { Database } from './tipos';

// O @supabase/ssr ja devolve a mesma instancia em chamadas repetidas no
// navegador, entao nao precisa de singleton na mao aqui.
export function clienteNavegador() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}
