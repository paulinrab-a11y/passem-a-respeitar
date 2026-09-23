// Client com a chave secreta. IGNORA RLS E ENXERGA O BANCO INTEIRO.
//
// So existe para o que o usuario legitimamente nao pode fazer sozinho:
// criar pedido com preco vindo do catalogo (#44), confirmar pagamento pelo
// webhook (#45), mudar status pela rota administrativa (#43), apagar conta
// (#39). Fora disso, use `clienteServidor()`, que respeita a RLS.
//
// Tres travas, porque uma chave dessas no bundle abre o banco inteiro:
//
//   1. `import 'server-only'` — o build QUEBRA se este arquivo entrar, direta
//      ou indiretamente, em qualquer arvore de client component.
//   2. sem prefixo NEXT_PUBLIC_ — o Next nao inlina a variavel no bundle.
//   3. passo `chave-secreta` no CI — varre o .next atras da chave depois do
//      build, caso as duas primeiras falhem.

import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL } from './env';
import type { Database } from './tipos';

export function clienteAdmin() {
  const chave = process.env.SUPABASE_SECRET_KEY;

  // Lido dentro da funcao, nao no topo do modulo como as outras variaveis: no
  // topo, um import acidental deste arquivo em contexto de cliente derrubaria
  // o build com "variavel nao definida", escondendo o erro de verdade, que e o
  // import estar onde nao devia.
  if (!chave) {
    throw new Error(
      'SUPABASE_SECRET_KEY nao definida. Ela e variavel de servidor: nunca com ' +
        'prefixo NEXT_PUBLIC_, nunca em client component.'
    );
  }

  return createClient<Database>(SUPABASE_URL, chave, {
    auth: {
      // Este client nao tem usuario nem sessao. Sem isso ele tentaria
      // persistir e renovar um token que nao existe.
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
