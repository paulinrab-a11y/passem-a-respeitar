import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  formataData,
  formataDataHora,
  formataDataPorExtenso,
  formataDiaHora,
  formataMesAbreviadoHora,
} from './datas';

/**
 * O processo de teste vai para UTC, que e onde a Vercel e a CI rodam. Sem
 * isto, na maquina do dono (em Brasilia) um formatador sem fuso da a mesma
 * resposta que o certo, e o teste passaria com o bug no lugar. O Node aceita
 * trocar `TZ` em tempo de execucao, e o Vitest isola cada arquivo de teste.
 */
const TZ_ORIGINAL = process.env.TZ;

beforeAll(() => {
  process.env.TZ = 'UTC';
});

afterAll(() => {
  if (TZ_ORIGINAL === undefined) delete process.env.TZ;
  else process.env.TZ = TZ_ORIGINAL;
});

/** 21:30 de 05/10 em Brasilia. Em UTC ja e 06/10, 00:30. */
const NOITE = '2026-10-05T21:30:00-03:00';

describe('datas em horario de Brasilia (#248)', () => {
  it('o processo esta em UTC, senao nada aqui prova alguma coisa', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
    // A falha que existia: sem fuso, o mesmo instante ja virou o dia.
    const semFuso = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
    expect(semFuso.format(new Date(NOITE))).toBe('06/10');
  });

  it('pedido das 21:30 fica no dia da compra, em todos os formatos do site', () => {
    expect(formataData(NOITE)).toBe('05/10/2026');
    expect(formataDataHora(NOITE)).toBe('05/10/2026, 21:30');
    expect(formataDiaHora(NOITE)).toBe('05/10, 21:30');
    expect(formataDataPorExtenso(NOITE)).toBe('05 de outubro de 2026');
    expect(formataMesAbreviadoHora(NOITE)).toBe('05 de out., 21:30');
  });

  it.each([
    // Ultimo minuto do dia em Brasilia, e o primeiro do dia seguinte.
    ['2026-10-06T02:59:00Z', '05/10/2026, 23:59'],
    ['2026-10-06T03:00:00Z', '06/10/2026, 00:00'],
    // Virada do ano: o ano tambem e o de Brasilia.
    ['2027-01-01T01:00:00Z', '31/12/2026, 22:00'],
    // Meio do dia: so a hora muda.
    ['2026-10-05T12:00:00Z', '05/10/2026, 09:00'],
  ])('%s em UTC e %s em Brasilia', (iso, esperado) => {
    expect(formataDataHora(iso)).toBe(esperado);
  });

  it('o ISO que o banco devolve, com fuso explicito ou em Z, da no mesmo', () => {
    expect(formataDataHora('2026-10-06T00:30:00+00:00')).toBe(formataDataHora(NOITE));
    expect(formataDataHora('2026-10-06T00:30:00Z')).toBe(formataDataHora(NOITE));
  });
});

/**
 * O helper so protege as telas que passam por ele. Este teste e o que faz uma
 * tela nova nao criar o proprio formatador e esquecer o fuso de novo.
 */
describe('um formatador so', () => {
  const PROPRIO = path.normalize('lib/datas.ts');
  const FORMATA_NO_FUSO_DO_PROCESSO = /Intl\.DateTimeFormat|toLocale(?:Date|Time)String\(/;

  function arquivosDoProjeto(): string[] {
    const saida: string[] = [];

    function anda(dir: string) {
      for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entrada.name.startsWith('.') || entrada.name === 'node_modules') continue;
        const cheio = path.join(dir, entrada.name);
        if (entrada.isDirectory()) anda(cheio);
        else if (/\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name)) {
          saida.push(cheio);
        }
      }
    }

    anda('app');
    anda('lib');
    return saida;
  }

  it('nenhuma tela de app/ ou lib/ formata data fora de lib/datas.ts', () => {
    const fora = arquivosDoProjeto().filter(
      (f) =>
        path.normalize(f) !== PROPRIO &&
        FORMATA_NO_FUSO_DO_PROCESSO.test(fs.readFileSync(f, 'utf8'))
    );

    expect(fora.map((f) => f.split(path.sep).join('/'))).toEqual([]);
  });

  it('o unico formatador leva o fuso de Brasilia', () => {
    const fonte = fs.readFileSync(PROPRIO, 'utf8');
    expect(fonte.match(/new Intl\.DateTimeFormat\(/g)).toHaveLength(1);
    expect(fonte).toContain("new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, ...opcoes })");
    expect(fonte).toContain("const FUSO = 'America/Sao_Paulo';");
  });
});
