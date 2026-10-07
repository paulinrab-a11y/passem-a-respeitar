// Client de servidor, com a sessao lida dos cookies do request.
//
// Usa a MESMA chave publishable do navegador. Isso e de proposito: a sessao do
// usuario e que define quem ele e, e a RLS continua valendo. Este arquivo nao
// tem poder nenhum a mais que o outro — quem ignora RLS e o admin.ts.

import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies, headers } from 'next/headers';
import { COOKIE_LEMBRAR, opcoesDoCookie } from './cookies';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './env';
import type { Database } from './tipos';

/**
 * User-agent e IP de quem pediu, para o Supabase gravar na sessao.
 *
 * O IP so vale em producao: rodando local nao ha `x-forwarded-for`, e o
 * Supabase registra o IP de saida desta maquina.
 *
 * Exportado para o client descartavel da conferencia de senha (#244): sem
 * isto a sessao que ele cria, mesmo durando um instante, nasce com o IP da
 * Vercel — e o limite por IP do Supabase conta contra o IP de saida, que e
 * de todo mundo, em vez do de quem digitou.
 */
export async function cabecalhosDeOrigem() {
  const h = await headers();
  const saida: Record<string, string> = {};

  const agente = h.get('user-agent');
  if (agente) saida['User-Agent'] = agente.slice(0, 400);

  const ip = h.get('x-forwarded-for');
  if (ip) saida['X-Forwarded-For'] = ip.split(',')[0].trim().slice(0, 64);

  return saida;
}

/**
 * A escolha de "manter conectado" feita no login, lida do cookie proprio.
 *
 * Toda acao que regrava a sessao depois do login — reautenticar, trocar
 * senha, trocar e-mail — passa isto para `clienteDeAuth`. Passar `true` fixo,
 * como se fazia (#244), transformava a sessao de um computador emprestado em
 * sessao de trinta dias no instante em que a pessoa digitava a senha para
 * provar quem era. Sem o cookie (login anterior a ele), vale o lado seguro.
 */
export async function lembrarDaSessao() {
  return (await cookies()).get(COOKIE_LEMBRAR)?.value === '1';
}

/**
 * Client para as acoes que ESCREVEM a sessao: login, cadastro, logout.
 *
 * Diferente de `clienteServidor()` em duas coisas: ele nao engole o erro de
 * escrever cookie (numa Server Action a escrita funciona, e falhar calado
 * deixaria a pessoa sem sessao depois de um login que disse ter dado certo) e
 * o "manter conectado" vem de quem chama, nao do cookie — no login a escolha
 * acabou de sair do formulario e o cookie dela ainda nao existe.
 */
export async function clienteDeAuth(lembrar: boolean) {
  const jar = await cookies();

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    // Repassa quem esta do outro lado. Sem isto o Supabase grava na sessao o
    // user-agent do NOSSO servidor, porque e ele quem faz o login — e a tela
    // de aparelhos conectados (#38) mostraria "Desconhecido" para todo mundo,
    // que e pior do que nao ter a tela.
    //
    // Valor de terceiro, entao vai cortado: cabecalho gigante viraria linha
    // gigante em auth.sessions.
    global: { headers: await cabecalhosDeOrigem() },
    cookies: {
      getAll() {
        return jar.getAll();
      },
      setAll(lista) {
        for (const { name, value, options } of lista) {
          jar.set(name, value, opcoesDoCookie(name, options, lembrar));
        }
      },
    },
  });
}

/**
 * Client para LER com a sessao de quem pediu.
 *
 * Ler tambem escreve: com o token vencido (uma hora sem renovar), o
 * `getUser()` renova a sessao e o Supabase pede para regravar o cookie. Fora
 * das rotas de conta e de login — a home, `/api` — o middleware nao renova
 * (`precisaDeSessao`), entao quem grava e este client — a barra da home chama `/api/conta/resumo` a cada
 * visita. Gravar com as opcoes cruas do Supabase deixava o token legivel por
 * JavaScript e valendo 400 dias, mesmo com "manter conectado" desmarcado.
 */
export async function clienteServidor() {
  const jar = await cookies();

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return jar.getAll();
      },
      setAll(lista) {
        // A escolha do login, relida a cada gravacao: este client nao sabe
        // como a sessao nasceu, e sem o cookie vale o lado seguro.
        const lembrar = jar.get(COOKIE_LEMBRAR)?.value === '1';

        try {
          for (const { name, value, options } of lista) {
            jar.set(name, value, opcoesDoCookie(name, options, lembrar));
          }
        } catch {
          // Server Component nao pode escrever cookie: o Next ja mandou os
          // headers. Engolir aqui e o certo — nas rotas de conta o middleware
          // ja renovou o token antes da pagina rodar, e nas outras a proxima
          // Route Handler ou Server Action renova e consegue gravar.
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
