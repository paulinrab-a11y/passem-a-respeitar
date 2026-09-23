// Client de servidor, com a sessao lida dos cookies do request.
//
// Usa a MESMA chave publishable do navegador. Isso e de proposito: a sessao do
// usuario e que define quem ele e, e a RLS continua valendo. Este arquivo nao
// tem poder nenhum a mais que o outro — quem ignora RLS e o admin.ts.

import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { opcoesDeSessao } from './cookies';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './env';
import type { Database } from './tipos';

/**
 * Client para as acoes que ESCREVEM a sessao: login, cadastro, logout.
 *
 * Diferente de `clienteServidor()` em duas coisas: ele nao engole o erro de
 * escrever cookie (numa Server Action a escrita funciona, e falhar calado
 * deixaria a pessoa sem sessao depois de um login que disse ter dado certo) e
 * ele aplica `opcoesDeSessao`, que endurece o cookie e trata o "manter
 * conectado".
 */
export async function clienteDeAuth(lembrar: boolean) {
  const jar = await cookies();

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return jar.getAll();
      },
      setAll(lista) {
        for (const { name, value, options } of lista) {
          jar.set(name, value, opcoesDeSessao(options, lembrar));
        }
      },
    },
  });
}

export async function clienteServidor() {
  const jar = await cookies();

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return jar.getAll();
      },
      setAll(lista) {
        try {
          for (const { name, value, options } of lista) {
            jar.set(name, value, options);
          }
        } catch {
          // Server Component nao pode escrever cookie: o Next ja mandou os
          // headers. Engolir aqui e o certo — o middleware renova a sessao a
          // cada request, entao o token atualizado chega pelo outro caminho.
          //
          // Sem esse catch, toda pagina que so LE dado do usuario quebraria no
          // momento em que o token fosse renovado.
        }
      },
    },
  });
}

/**
 * Usuario da sessao, ou null.
 *
 * Use isto, nunca `getSession()`. A diferenca importa:
 *
 *   getSession()  le o cookie e acredita nele
 *   getUser()     manda o token ao servidor do Supabase, que confere a assinatura
 *
 * Cookie chega do navegador, e o que chega do navegador e afirmacao, nao fato.
 * `getSession()` no servidor aceita um token forjado; `getUser()` nao.
 */
export async function usuarioDaSessao() {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}
