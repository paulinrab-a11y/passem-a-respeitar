import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATA_DE_LANCAMENTO, LANCAMENTO_CURTO, LANCAMENTO_POR_EXTENSO } from './ep';

describe('data de lancamento (#269)', () => {
  it('um dia do calendario, e os dois formatos saem dele', () => {
    expect(DATA_DE_LANCAMENTO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const [ano, mes, dia] = DATA_DE_LANCAMENTO.split('-');
    expect(LANCAMENTO_CURTO).toBe(`${dia}.${mes}`);
    expect(LANCAMENTO_POR_EXTENSO).toMatch(new RegExp(`^${Number(dia)} de [a-zç]+ de ${ano}$`));
  });

  /**
   * Fonte unica: nenhum codigo de app/ ou lib/ escreve a data a mao. Se a
   * data mudar, muda em lib/ep.ts e o resto acompanha.
   */
  it('nenhum arquivo de app/ ou lib/ escreve a data fora de lib/ep.ts', () => {
    const [ano, mes, dia] = DATA_DE_LANCAMENTO.split('-');
    const jeitos = [
      DATA_DE_LANCAMENTO,
      `${dia}/${mes}`,
      `${dia}.${mes}`,
      `${dia}-${mes}`,
      LANCAMENTO_POR_EXTENSO,
      LANCAMENTO_POR_EXTENSO.replace(` de ${ano}`, ''),
    ];
    const proprio = path.normalize('lib/ep.ts');
    const fontes: string[] = [];
    const anda = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const cheio = path.join(dir, e.name);
        if (e.isDirectory()) anda(cheio);
        else if (/\.(tsx?|js|css)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          fontes.push(cheio);
        }
      }
    };
    anda('app');
    anda('lib');

    const comData = fontes.filter((f) => {
      if (path.normalize(f) === proprio) return false;
      const texto = fs.readFileSync(f, 'utf8');
      return jeitos.some((j) =>
        new RegExp(`(^|[^\\d])${j.replace(/\./g, '\\.')}($|[^\\d])`).test(texto)
      );
    });
    expect(comData.map((f) => f.split(path.sep).join('/'))).toEqual([]);
  });
});
