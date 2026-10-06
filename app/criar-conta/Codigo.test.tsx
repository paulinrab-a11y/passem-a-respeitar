// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EstadoCodigo, EstadoReenvio } from './estado';

/**
 * A tela do codigo (#224): um campo, seis digitos, envio sozinho; colar com
 * texto em volta funciona; codigo errado limpa o campo e mantem a tela;
 * reenviar espera 60 s; trocar e-mail devolve ao formulario.
 */
const confirmarCodigo = vi.fn(
  async (anterior: EstadoCodigo, form: FormData): Promise<EstadoCodigo> => {
    recebidos.push(String(form.get('codigo')));
    return { erro: 'Código inválido ou vencido.', tentativa: anterior.tentativa + 1 };
  }
);
const reenviarCodigo = vi.fn(
  async (anterior: EstadoReenvio, _form: FormData): Promise<EstadoReenvio> => ({
    erro: null,
    aviso: 'Se o e-mail for válido, enviamos outro código.',
    reenviadoEm: Date.now(),
    tentativa: anterior.tentativa + 1,
  })
);
let recebidos: string[] = [];

vi.mock('./acoes', () => ({
  confirmarCodigo: (a: EstadoCodigo, f: FormData) => confirmarCodigo(a, f),
  reenviarCodigo: (a: EstadoReenvio, f: FormData) => reenviarCodigo(a, f),
}));

import Codigo, { ESPERA_REENVIO_S } from './Codigo';

const campo = () => screen.getByLabelText(/Código de 6 dígitos/) as HTMLInputElement;

beforeEach(() => {
  recebidos = [];
  vi.clearAllMocks();
  // requestSubmit nao existe no jsdom: vira um submit normal do formulario.
  HTMLFormElement.prototype.requestSubmit ??= function () {
    this.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  };
});
afterEach(cleanup);

describe('tela do codigo (#224)', () => {
  it('mostra o e-mail, pede seis digitos e oferece entrar', () => {
    render(<Codigo email="maria@exemplo.com" aoTrocarEmail={() => {}} />);

    expect(screen.getByText('maria@exemplo.com')).toBeTruthy();
    const c = campo();
    expect(c.getAttribute('inputmode')).toBe('numeric');
    expect(c.getAttribute('autocomplete')).toBe('one-time-code');
    expect(c.maxLength).toBe(6);
    expect(screen.getByRole('link', { name: 'Entrar' }).getAttribute('href')).toBe('/entrar');
    expect((screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('colar "Seu código: 123 456" vira 123456 e envia sozinho', async () => {
    render(<Codigo email="maria@exemplo.com" aoTrocarEmail={() => {}} />);

    await act(async () => {
      fireEvent.change(campo(), { target: { value: 'Seu código: 123 456' } });
    });
    await screen.findByRole('alert');

    expect(recebidos).toEqual(['123456']);
  });

  it('com cinco digitos nao envia; o botao fica desabilitado', async () => {
    render(<Codigo email="maria@exemplo.com" aoTrocarEmail={() => {}} />);

    await act(async () => {
      fireEvent.change(campo(), { target: { value: '12345' } });
    });

    expect(confirmarCodigo).not.toHaveBeenCalled();
    expect(campo().value).toBe('12345');
    expect((screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('codigo errado mostra o erro, limpa o campo e mantem a tela', async () => {
    render(<Codigo email="maria@exemplo.com" aoTrocarEmail={() => {}} />);

    await act(async () => {
      fireEvent.change(campo(), { target: { value: '000000' } });
    });
    const erro = await screen.findByRole('alert');

    expect(erro.textContent).toMatch(/inválido ou vencido/);
    expect(campo().value).toBe('');
    expect(screen.getByText('maria@exemplo.com')).toBeTruthy();
  });

  it('reenviar espera 60 s, com a contagem no botao', () => {
    render(<Codigo email="maria@exemplo.com" aoTrocarEmail={() => {}} />);

    const reenviar = screen.getByRole('button', {
      name: new RegExp(`Reenviar código \\(${ESPERA_REENVIO_S} s\\)`),
    }) as HTMLButtonElement;
    expect(reenviar.disabled).toBe(true);
  });

  it('trocar e-mail avisa quem chamou', () => {
    const volta = vi.fn();
    render(<Codigo email="maria@exemplo.com" aoTrocarEmail={volta} />);

    fireEvent.click(screen.getByRole('button', { name: 'Trocar e-mail' }));

    expect(volta).toHaveBeenCalledTimes(1);
  });
});
