// Ambiente da suite de ponta a ponta (Issue #10).
//
// A suite cria conta, troca senha e apaga usuario. Isso so pode acontecer num
// banco que nasceu para morrer: o Supabase LOCAL, que o `supabase start` sobe
// em Docker com as migrations do repositorio. Este arquivo e o unico lugar que
// sabe onde esse banco esta, e e ele que se recusa a continuar se o endereco
// nao for desta maquina.
//
// Nenhuma chave esta escrita aqui. Elas sao lidas do `supabase status` na hora
// de rodar: sao as chaves do banco local, e nao abrem nada fora dele.

import { execSync } from 'node:child_process';

/**
 * Onde o site sobe. E o `site_url` do supabase/config.toml.
 *
 * `localhost`, e nao `127.0.0.1`. Sob `next start`, um route handler enxerga
 * `request.nextUrl.origin` como `localhost`, venha o pedido pelo endereco que
 * vier. O callback dos links de e-mail redireciona a partir dessa origem: com
 * o site aberto em 127.0.0.1 a pessoa era mandada para localhost, que e outro
 * host, e chegava la sem o cookie que tinha acabado de receber. Na Vercel a
 * origem e a do pedido, e isso nao acontece.
 */
export const SITE = 'http://localhost:3000';

/**
 * O administrador da suite. O site decide quem administra por uma lista de
 * e-mails no ambiente do servidor, entao o endereco precisa existir antes de o
 * servidor subir. Dominio reservado para teste: nao e de ninguem.
 */
export const ADMIN = 'admin@e2e.test';

const DESTA_MAQUINA = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function ehDestaMaquina(url) {
  try {
    return DESTA_MAQUINA.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

function leStatus() {
  let saida;
  try {
    saida = execSync('npx supabase status -o env', {
      encoding: 'utf8',
      // O aviso de "servicos parados" sai no stderr e nao interessa.
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    throw new Error(
      'O Supabase local nao esta no ar. Abra o Docker e rode `npm run e2e:banco` antes da suite.'
    );
  }

  const pares = {};
  for (const linha of saida.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)="?([^"]*)"?$/.exec(linha.trim());
    if (m) pares[m[1]] = m[2];
  }
  return pares;
}

/**
 * Endereco e chaves do Supabase local.
 *
 * O resultado fica em `process.env`: o Playwright carrega a configuracao no
 * processo principal e de novo em cada worker, e os workers herdam o ambiente.
 * Assim o `supabase status` roda uma vez por rodada, nao uma por arquivo.
 */
export function ambienteLocal() {
  if (!process.env.E2E_SUPABASE_URL) {
    const s = leStatus();
    process.env.E2E_SUPABASE_URL = s.API_URL ?? '';
    // Os nomes novos primeiro, que sao os que producao usa. Os antigos ficam
    // de reserva para uma CLI que ainda nao emita os novos.
    process.env.E2E_CHAVE_PUBLICA = s.PUBLISHABLE_KEY || s.ANON_KEY || '';
    process.env.E2E_CHAVE_SECRETA = s.SECRET_KEY || s.SERVICE_ROLE_KEY || '';
    process.env.E2E_CORREIO = s.MAILPIT_URL || s.INBUCKET_URL || '';
  }

  const local = {
    supabase: process.env.E2E_SUPABASE_URL ?? '',
    chavePublica: process.env.E2E_CHAVE_PUBLICA ?? '',
    chaveSecreta: process.env.E2E_CHAVE_SECRETA ?? '',
    correio: process.env.E2E_CORREIO ?? '',
  };

  for (const [nome, valor] of Object.entries(local)) {
    if (!valor) throw new Error(`O Supabase local nao informou "${nome}".`);
  }

  // A trava. Sem ela, um ambiente mal configurado faria a suite criar e apagar
  // usuario num banco de verdade.
  for (const url of [local.supabase, local.correio]) {
    if (!ehDestaMaquina(url)) {
      throw new Error(`A suite so roda contra esta maquina, e recebeu ${new URL(url).host}.`);
    }
  }

  return local;
}
