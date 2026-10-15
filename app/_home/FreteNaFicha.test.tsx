// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FreteNaFicha as Resposta } from './acoes';

vi.mock('./acoes', () => ({ cotarFreteNaFicha: vi.fn() }));

const { cotarFreteNaFicha } = await import('./acoes');
const { esqueceCep } = await import('./cep-lembrado');
const { default: FreteNaFicha } = await import('./FreteNaFicha');

const SEDEX = { servico: 'sedex', nome: 'SEDEX', precoCentavos: 1432, prazoDias: 2 } as const;
const COTADO: Resposta = { ok: true, opcoes: [SEDEX] };
const limpo = (texto: string) => texto.replace(/\s/g, ' ');

const monta = () => render(<FreteNaFicha slug="camiseta-cbac" tamanho="M" />);
const campo = () => screen.getByLabelText('Frete para o seu CEP') as HTMLInputElement;
const digita = (cep: string) =>
  act(async () => {
    fireEvent.change(campo(), { target: { value: cep } });
  });

beforeEach(() => {
  esqueceCep();
  vi.mocked(cotarFreteNaFicha).mockReset();
  vi.mocked(cotarFreteNaFicha).mockResolvedValue(COTADO);
});

afterEach(() => {
  cleanup();
  esqueceCep();
});

describe('frete na ficha (#205)', () => {
  it('antes do CEP, a linha de resposta existe e esta vazia', () => {
    const { container } = monta();
    const linha = container.querySelector('.frete-ficha-resposta') as HTMLElement;
    expect(linha).not.toBeNull();
    expect(linha.textContent).toBe('');
    expect(cotarFreteNaFicha).not.toHaveBeenCalled();
  });

  it('CEP pela metade nao consulta', async () => {
    monta();
    await digita('0131010');
    expect(cotarFreteNaFicha).not.toHaveBeenCalled();
  });

  it('CEP completo consulta com a camiseta e mostra preco e prazo', async () => {
    monta();
    await digita('01310-100');

    expect(cotarFreteNaFicha).toHaveBeenCalledWith({
      slug: 'camiseta-cbac',
      tamanho: 'M',
      cep: '01310100',
    });
    const texto = limpo(screen.getByRole('list').textContent ?? '');
    expect(texto).toContain('SEDEX');
    expect(texto).toContain('R$ 14,32');
    expect(texto).toContain('até 2 dias úteis depois da produção');
  });

  it('mostra o CEP com hifen, e guarda so os digitos', async () => {
    monta();
    await digita('01310100');
    expect(campo().value).toBe('01310-100');
    expect(window.localStorage.getItem('par_cep')).toBe('01310100');
  });

  it('erro da cotacao aparece como aviso, sem lista', async () => {
    vi.mocked(cotarFreteNaFicha).mockResolvedValue({ ok: false, texto: 'Confira o CEP.' });
    monta();
    await digita('99999999');

    expect(screen.getByRole('status').textContent).toBe('Confira o CEP.');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('apagar um digito tira o preco da tela', async () => {
    const { container } = monta();
    await digita('01310100');
    expect(screen.getByRole('list')).toBeTruthy();

    await digita('0131010');
    expect(screen.queryByRole('list')).toBeNull();
    expect(container.querySelector('.frete-ficha-resposta')?.textContent).toBe('');
  });

  it('duas fichas na mesma pagina mostram o mesmo CEP', async () => {
    render(
      <>
        <FreteNaFicha slug="camiseta-cbac" tamanho="M" />
        <FreteNaFicha slug="camiseta-cbac" tamanho="M" />
      </>
    );
    const [a, b] = screen.getAllByLabelText('Frete para o seu CEP') as HTMLInputElement[];
    await act(async () => {
      fireEvent.change(a, { target: { value: '04538133' } });
    });
    expect(b.value).toBe('04538-133');
  });

  it('a resposta de um CEP velho nao toma o lugar da do novo', async () => {
    let soltaVelho: (r: Resposta) => void = () => {};
    vi.mocked(cotarFreteNaFicha)
      .mockReturnValueOnce(
        new Promise((r) => {
          soltaVelho = r;
        })
      )
      .mockResolvedValueOnce({ ok: true, opcoes: [{ ...SEDEX, precoCentavos: 3100 }] });
    monta();
    await digita('01310100');
    await digita('20040002');
    expect(limpo(screen.getByRole('list').textContent ?? '')).toContain('R$ 31,00');

    await act(async () => soltaVelho(COTADO));
    expect(limpo(screen.getByRole('list').textContent ?? '')).toContain('R$ 31,00');
  });

  it('duas fichas e um CEP completo: uma consulta so, e as duas mostram o preco (#308)', async () => {
    render(
      <>
        <FreteNaFicha slug="camiseta-cbac" tamanho="M" />
        <FreteNaFicha slug="camiseta-cbac" tamanho="M" />
      </>
    );
    const [a] = screen.getAllByLabelText('Frete para o seu CEP') as HTMLInputElement[];
    await act(async () => {
      fireEvent.change(a, { target: { value: '01310100' } });
    });

    expect(cotarFreteNaFicha).toHaveBeenCalledTimes(1);
    const listas = screen.getAllByRole('list');
    expect(listas).toHaveLength(2);
    for (const l of listas) expect(limpo(l.textContent ?? '')).toContain('R$ 14,32');
  });

  it('a segunda ficha que monta com o CEP ja cotado nao consulta de novo (#308)', async () => {
    monta();
    await digita('01310100');
    await act(async () => {
      monta();
    });

    expect(cotarFreteNaFicha).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('list')).toHaveLength(2);
  });

  it('recusa nao fica guardada: apagar um digito e digitar de novo pergunta outra vez', async () => {
    vi.mocked(cotarFreteNaFicha).mockResolvedValueOnce({ ok: false, texto: 'Tente de novo.' });
    monta();
    await digita('01310100');
    expect(screen.getByRole('status').textContent).toBe('Tente de novo.');

    await digita('0131010');
    await digita('01310100');
    expect(cotarFreteNaFicha).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('list')).toBeTruthy();
  });

  it('a action que falha na rede vira aviso, nao "Calculando" para sempre', async () => {
    vi.mocked(cotarFreteNaFicha).mockRejectedValueOnce(new Error('rede'));
    monta();
    await digita('01310100');
    expect(screen.getByRole('status').textContent).toBe(
      'Não consegui calcular o frete agora. Tente de novo em instantes.'
    );
  });
});
