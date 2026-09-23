import { describe, expect, it } from 'vitest';
import { leAparelho, mapeiaSessoes, redeLegivel } from './sessoes';

describe('leAparelho', () => {
  // Estes tres sao a razao de a ordem das regras importar: Edge e Opera
  // anunciam "Chrome" no proprio user-agent, e o Chrome anuncia "Safari".
  // Testar Chrome primeiro marcaria todos como Chrome.
  it.each([
    [
      'Edge',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0',
      'Edge',
      'Windows',
    ],
    [
      'Opera',
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/119.0 Safari/537.36 OPR/105.0',
      'Opera',
      'Windows',
    ],
    [
      'Chrome',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      'Chrome',
      'Windows',
    ],
    [
      'Safari no iPhone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Version/17.2 Mobile/15E148 Safari/604.1',
      'Safari',
      'iOS',
    ],
    [
      'Chrome no Android',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
      'Chrome',
      'Android',
    ],
    [
      'Firefox no macOS',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
      'Firefox',
      'macOS',
    ],
    [
      'Chrome no iOS, que usa CriOS',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0 Mobile/15E148 Safari/604.1',
      'Chrome',
      'iOS',
    ],
    [
      'Samsung Internet',
      'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 SamsungBrowser/23.0 Chrome/115.0 Mobile Safari/537.36',
      'Samsung Internet',
      'Android',
    ],
  ])('reconhece %s', (_nome, agente, navegador, sistema) => {
    expect(leAparelho(agente)).toEqual({ navegador, sistema });
  });

  it('nao inventa quando nao sabe', () => {
    expect(leAparelho('alguma-coisa-esquisita/1.0')).toEqual({
      navegador: 'Desconhecido',
      sistema: '',
    });
  });

  it('aguenta user-agent ausente', () => {
    expect(leAparelho(null)).toEqual({ navegador: 'Desconhecido', sistema: '' });
  });
});

describe('redeLegivel', () => {
  // O banco ja zera os dois ultimos octetos. Aqui so troca por "x" para nao
  // parecer um endereco de verdade.
  it('mostra a rede, nao o endereco', () => {
    expect(redeLegivel('189.6.0.0')).toBe('189.6.x.x');
  });

  it('encurta IPv6', () => {
    expect(redeLegivel('2804:14c:8781::')).toBe('2804:14c:…');
  });

  it('aguenta ausencia', () => {
    expect(redeLegivel(null)).toBe(null);
  });

  it('recusa o que nao tem cara de rede', () => {
    expect(redeLegivel('nao-e-ip')).toBe(null);
  });
});

describe('mapeiaSessoes', () => {
  const linha = {
    identificador: 'a'.repeat(64),
    ultimo_acesso: '2026-09-23T12:00:00Z',
    agente: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
    rede: '189.6.0.0',
    e_a_atual: true,
  };

  it('tem exatamente os campos da lista', () => {
    expect(Object.keys(mapeiaSessoes([linha])[0]).sort()).toEqual([
      'atual',
      'identificador',
      'navegador',
      'rede',
      'sistema',
      'ultimoAcesso',
    ]);
  });

  // O user-agent cru tem versao de build e as vezes nome de aparelho. Nada
  // disso ajuda a pessoa a decidir, e tudo isso ajuda quem esta olhando.
  it('nao repassa o user-agent cru', () => {
    const texto = JSON.stringify(mapeiaSessoes([linha]));

    expect(texto).not.toContain('Mozilla');
    expect(texto).not.toContain('AppleWebKit');
    expect(texto).not.toContain('537.36');
  });

  it('nao repassa o endereco de rede como veio', () => {
    expect(JSON.stringify(mapeiaSessoes([linha]))).not.toContain('189.6.0.0');
  });

  // `criada_em` vem da funcao do banco e e descartado: duas datas lado a lado
  // so confundem, e a que importa e a ultima.
  it('descarta campos que a tela nao usa', () => {
    const comExtra = { ...linha, criada_em: '2020-01-01T00:00:00Z' };
    expect(JSON.stringify(mapeiaSessoes([comExtra]))).not.toContain('2020');
  });

  it('marca a sessao atual', () => {
    expect(mapeiaSessoes([linha])[0].atual).toBe(true);
    expect(mapeiaSessoes([{ ...linha, e_a_atual: false }])[0].atual).toBe(false);
  });

  it('aguenta lista vazia', () => {
    expect(mapeiaSessoes([])).toEqual([]);
  });
});
