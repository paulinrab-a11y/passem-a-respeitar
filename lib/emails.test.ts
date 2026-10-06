import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CONTATO as CONTATO_DOS_EMAILS,
  EMAILS,
  guia,
  html,
  saidas,
} from '../supabase/templates/modelos.mjs';
import { CONTATO } from './contato';

/**
 * Os e-mails de conta (#183), sem navegador e sem Supabase.
 *
 * Quem prova que o e-mail CHEGA, em portugues e com as variaveis preenchidas,
 * e o teste de ponta a ponta. Aqui fica o que da para errar sem perceber:
 * editar o .html na mao, usar uma variavel que aquele modelo nao tem, escrever
 * um texto que conta se a conta existe.
 */

const CONFIG = readFileSync('supabase/config.toml', 'utf8').replace(/\r\n/g, '\n');
const noDisco = (nome: string) =>
  readFileSync(`supabase/templates/${nome}`, 'utf8').replace(/\r\n/g, '\n');

/** O que cada modelo pode usar, pela documentacao do Supabase. */
const DE_TODOS = ['SiteURL', 'Data'];
const DE_CONFIRMACAO = ['ConfirmationURL', 'TokenHash', 'RedirectTo', 'Email', ...DE_TODOS];
const VARIAVEIS: Record<string, string[]> = {
  // Codigo e link no mesmo e-mail (#224).
  confirmation: [...DE_CONFIRMACAO, 'Token'],
  recovery: DE_CONFIRMACAO,
  invite: DE_CONFIRMACAO,
  email_change: [...DE_CONFIRMACAO, 'NewEmail'],
  magic_link: [...DE_CONFIRMACAO, 'Token'],
  reauthentication: [...DE_CONFIRMACAO, 'Token'],
  password_changed: ['Email', ...DE_TODOS],
  email_changed: ['Email', 'OldEmail', ...DE_TODOS],
  // Os cinco que o site nao dispara, e que por isso nenhum teste de ponta a
  // ponta alcanca: so o que a documentacao garante para cada um.
  phone_changed: ['Phone', 'OldPhone', ...DE_TODOS],
  identity_linked: ['Provider', ...DE_TODOS],
  identity_unlinked: ['Provider', ...DE_TODOS],
  mfa_factor_enrolled: ['FactorType', ...DE_TODOS],
  mfa_factor_unenrolled: ['FactorType', ...DE_TODOS],
};

/** O painel do Supabase, como na tela de 29/09/2026: secao, linha, ordem. */
const PAINEL = [
  ['Authentication', 'Confirm sign up'],
  ['Authentication', 'Invite user'],
  ['Authentication', 'Magic link or OTP'],
  ['Authentication', 'Change email address'],
  ['Authentication', 'Reset password'],
  ['Authentication', 'Reauthentication'],
  ['Security', 'Password changed'],
  ['Security', 'Email address changed'],
  ['Security', 'Phone number changed'],
  ['Security', 'Sign-in method linked'],
  ['Security', 'Sign-in method removed'],
  ['Security', 'MFA method added'],
  ['Security', 'MFA method removed'],
];

const usadas = (texto: string) => [...texto.matchAll(/\{\{\s*\.(\w+)\s*\}\}/g)].map((m) => m[1]);

describe('os treze modelos', () => {
  it('ha um para cada linha do painel, na ordem da tela', () => {
    expect(EMAILS.map((e) => [e.secao, e.painel])).toEqual(PAINEL);
  });

  it('as chaves sao as que o Supabase conhece', () => {
    expect(EMAILS.map((e) => e.chave).sort()).toEqual(Object.keys(VARIAVEIS).sort());
  });

  it('Authentication e modelo; Security e aviso', () => {
    for (const e of EMAILS) {
      expect(e.tipo, e.painel).toBe(e.secao === 'Security' ? 'notification' : 'template');
    }
  });

  it.each(EMAILS)('$chave: o .html no disco e o que o gerador escreve', (e) => {
    expect(noDisco(`${e.chave}.html`)).toBe(html(e));
  });

  it('o guia no disco tambem', () => {
    const [, esperado] = saidas().find(([nome]) => nome === 'guia.html') ?? [];

    expect(noDisco('guia.html')).toBe(esperado);
  });

  it.each(EMAILS)('$chave: so usa variavel que este modelo tem', (e) => {
    const naoTem = usadas(html(e)).filter((v) => !VARIAVEIS[e.chave].includes(v));

    expect(naoTem).toEqual([]);
  });

  it.each(EMAILS)('$chave: toda chave dupla e uma variavel inteira', (e) => {
    const semVariaveis = html(e).replace(/\{\{\s*\.\w+\s*\}\}/g, '');

    expect(semVariaveis).not.toContain('{{');
    expect(semVariaveis).not.toContain('}}');
  });
});

describe('o que cada e-mail tem', () => {
  it.each(EMAILS)('$chave: portugues, titulo, contato e assinatura', (e) => {
    const h = html(e);

    expect(h).toContain('<html lang="pt-BR">');
    expect(h).toContain(`<title>${e.assunto}</title>`);
    expect(h).toContain(e.titulo);
    expect(h).toContain(`mailto:${CONTATO}`);
    expect(h).toContain('Santxx x Ch3fe · Whynot Visuals');
    expect(e.assunto.endsWith('— Passem a Respeitar')).toBe(true);
  });

  it.each(EMAILS)('$chave: diz o que fazer se nao foi a pessoa', (e) => {
    expect(e.aviso.startsWith('Não foi você?') || e.aviso.startsWith('Não esperava')).toBe(true);
  });

  it.each(EMAILS.filter((e) => e.botao))(
    '$chave: o destino do botao aparece tambem por extenso',
    (e) => {
      const [rotulo, destino] = e.botao ?? [];
      const h = html(e);

      expect(h).toContain(`>${rotulo}</a>`);
      // No botao, no endereco por extenso e no texto dele.
      expect(h.split(destino).length - 1).toBe(3);
    }
  );

  it('"Magic link or OTP" serve aos dois: tem o link e tem o codigo', () => {
    const h = html(EMAILS.find((e) => e.chave === 'magic_link') ?? EMAILS[0]);

    expect(usadas(h).filter((v) => v === 'Token')).toHaveLength(1);
    expect(usadas(h).filter((v) => v === 'ConfirmationURL')).toHaveLength(3);
    // O botao vem antes do codigo.
    expect(h.indexOf('>Entrar</a>')).toBeLessThan(h.indexOf('{{ .Token }}'));
  });

  it('o codigo de confirmacao aparece uma vez, e nao ha link nesse e-mail', () => {
    const h = html(EMAILS.find((e) => e.chave === 'reauthentication') ?? EMAILS[0]);

    expect(usadas(h)).toEqual(['Token']);
  });

  it('o aviso de senha trocada leva ao pedido de senha nova, no proprio site', () => {
    const e = EMAILS.find((m) => m.chave === 'password_changed');

    expect(e?.botao?.[1]).toBe('{{ .SiteURL }}/recuperar-senha');
  });
});

describe('o que nenhum e-mail tem', () => {
  it.each(EMAILS)('$chave: imagem, fonte, folha de estilo ou script', (e) => {
    const h = html(e);

    // Sem imagem o e-mail chega inteiro com imagem bloqueada, e nao avisa
    // ninguem de que foi aberto.
    expect(h).not.toMatch(/<img\b|<link\b|<script\b|<style\b|@import|url\(/i);
  });

  it.each(EMAILS)('$chave: endereco fixo de site', (e) => {
    // O endereco do site vem do Supabase. Escrito aqui, quebraria no dia da
    // troca de dominio (#54) sem ninguem perceber.
    expect(html(e)).not.toMatch(/https?:\/\/(?!\{)/);
  });

  it.each(EMAILS)('$chave: texto em ingles do modelo padrao', (e) => {
    expect(html(e)).not.toMatch(/confirm your|follow this link|reset password|magic link/i);
  });

  it('os e-mails de pedido nao dizem se a conta existe', () => {
    // Quem recebe o e-mail de cadastro ou de recuperacao recebe porque alguem
    // digitou o endereco. O texto fala do pedido, nunca do estado da conta.
    for (const chave of ['confirmation', 'recovery']) {
      const e = EMAILS.find((m) => m.chave === chave);
      const texto = [...(e?.texto ?? []), e?.aviso ?? ''].join(' ');

      expect(texto).not.toMatch(/já (tem|existe|possui)|não (tem|existe) conta|cadastrad/i);
    }
  });
});

describe('contraste', () => {
  const luz = (cor: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = Number.parseInt(cor.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contraste = (a: string, b: string) => {
    const [claro, escuro] = [luz(a), luz(b)].sort((x, y) => y - x);
    return (claro + 0.05) / (escuro + 0.05);
  };

  it('todo texto passa de 4,5 para 1 sobre o fundo em que esta', () => {
    const h = html(EMAILS[0]);
    const cores = [...h.matchAll(/(?<![-\w])color:(#[0-9a-f]{6})/g)].map((m) => m[1]);

    expect(cores.length).toBeGreaterThan(5);
    for (const cor of new Set(cores)) {
      // O botao e preto sobre prata; o resto, claro sobre a caixa escura.
      const fundo = cor === '#000000' ? '#cdd0d5' : '#0a0a0a';
      expect(contraste(cor, fundo), `${cor} sobre ${fundo}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('o vermelho so aparece em linha, nunca em texto', () => {
    expect(html(EMAILS[0])).not.toMatch(/(?<![-\w])color:#e0161f/);
  });
});

describe('Supabase local', () => {
  it.each(EMAILS)('$chave: o config.toml aponta para o arquivo, com o mesmo assunto', (e) => {
    const secao = `[auth.email.${e.tipo}.${e.chave}]\n`;
    const ini = CONFIG.indexOf(secao);
    expect(ini, secao).toBeGreaterThan(-1);

    const corpo = CONFIG.slice(ini + secao.length, CONFIG.indexOf('\n\n', ini));

    expect(corpo).toContain(`subject = "${e.assunto}"`);
    expect(corpo).toContain(`content_path = "./supabase/templates/${e.chave}.html"`);
    if (e.tipo === 'notification') expect(corpo).toContain(`enabled = ${e.ligar}`);
  });
});

describe('guia para o painel', () => {
  const pagina = guia('https://painel.exemplo/');

  it('tem os treze modelos, pelo nome e na ordem do painel', () => {
    const titulos = [...pagina.matchAll(/<\/span>([^<]+)<\/h2>/g)].map((m) => m[1]);

    expect(titulos).toEqual(PAINEL.map(([, linha]) => linha));
    expect(pagina.match(/<section>/g)).toHaveLength(13);
  });

  it('cada bloco diz em que secao do painel a linha esta', () => {
    expect(pagina.match(/Seção <b>Authentication<\/b>/g)).toHaveLength(6);
    expect(pagina.match(/Seção <b>Security<\/b>/g)).toHaveLength(7);
  });

  it('nao fala em aba que o painel nao tem', () => {
    expect(pagina).not.toContain('Security notifications');
    expect(pagina).toContain('aba <b>Templates</b>');
  });

  it('cada campo tem rotulo, e cada botao sabe o que copia', () => {
    const campos = [...pagina.matchAll(/<(?:input|textarea)[^>]* id="(\w+)"/g)].map((m) => m[1]);

    expect(campos).toHaveLength(EMAILS.length * 2);
    for (const id of campos) {
      expect(pagina).toContain(`<label for="${id}">`);
      expect(pagina).toContain(`data-de="${id}"`);
    }
  });

  it('o corpo vai escapado: o guia mostra o HTML, nao o desenha', () => {
    expect(pagina).toContain('&lt;!doctype html&gt;');
    expect(pagina.match(/<!doctype html>/g)).toHaveLength(1);
  });

  it('manda ligar so os dois avisos que o site dispara', () => {
    expect(EMAILS.filter((e) => e.ligar).map((e) => e.painel)).toEqual([
      'Password changed',
      'Email address changed',
    ]);
    expect(pagina.match(/ligue a chave desta linha/g)).toHaveLength(2);
    expect(pagina).toContain('ligue só as chaves de Password changed e Email address changed');
    expect(pagina).toContain('Save changes');
  });

  it('nos outros cinco, diz para deixar desligado e por que', () => {
    const desligados = EMAILS.filter((e) => e.tipo === 'notification' && !e.ligar);

    expect(desligados).toHaveLength(5);
    expect(pagina.match(/deixe a chave desligada/g)).toHaveLength(5);
    for (const e of desligados) expect(pagina).toContain(e.semUso);
  });
});

describe('endereco de contato', () => {
  it('e o mesmo no site e nos e-mails', () => {
    expect(CONTATO_DOS_EMAILS).toBe(CONTATO);
  });

  it('esta na politica de privacidade, como link de e-mail', () => {
    const pagina = readFileSync('app/privacidade/page.tsx', 'utf8');

    expect(pagina).toContain("import { CONTATO } from '@/lib/contato';");
    expect(pagina).toMatch(/<a href=\{`mailto:\$\{CONTATO\}`\}>\{CONTATO\}<\/a>/);
    // A frase de antes do endereco existir, com qualquer nome de selo.
    expect(pagina).not.toContain('canal de contato da');
  });
});
