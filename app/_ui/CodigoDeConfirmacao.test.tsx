// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CodigoDeConfirmacao, { ESPERA_REENVIO_S } from './CodigoDeConfirmacao';
import type { EstadoCodigo, EstadoReenvio } from './estado-do-codigo';

/**
 * O campo do codigo (#224, #260), o mesmo no cadastro, no login e em /conta:
 * um campo, oito digitos, envio sozinho; colar com texto em volta funciona;
 * codigo errado limpa o campo e devolve o foco; o reenvio espera; o que vai
 * junto no envio e de quem chama.
 */
let recebidos: FormData[] = [];
let respostaDoCodigo: (anterior: EstadoCodigo) => EstadoCodigo;

const confirmar = vi.fn(async (anterior: EstadoCodigo, form: FormData) => {
  recebidos.push(form);
  return respostaDoCodigo(anterior);
});
const reenviar = vi.fn(
  async (anterior: EstadoReenvio, _form: FormData): Promise<EstadoReenvio> => ({
    erro: null,
    aviso: 'Enviamos outro código.',
    reenviadoEm: Date.now(),
    tentativa: anterior.tentativa + 1,
  })
);

const errado = (anterior: EstadoCodigo) => ({
  erro: 'Código inválido ou vencido.',
  tentativa: anterior.tentativa + 1,
});

const campo = () => screen.getByLabelText(/Código de 8 dígitos/) as HTMLInputElement;
const botao = (nome: string | RegExp) =>
  screen.getByRole('button', { name: nome }) as HTMLButtonElement;

function tela(props: Partial<Parameters<typeof CodigoDeConfirmacao>[0]> = {}) {
  return render(
    <CodigoDeConfirmacao
      intro={<>Enviamos um código para maria@exemplo.com.</>}
      confirmar={confirmar}
      reenviar={reenviar}
      {...props}
    />
  );
}

async function digita(valor: string) {
  await act(async () => {
    fireEvent.change(campo(), { target: { value: valor } });
  });
}

beforeEach(() => {
  recebidos = [];
  respostaDoCodigo = errado;
  vi.clearAllMocks();
  // requestSubmit nao existe no jsdom: vira um submit normal do formulario.
  HTMLFormElement.prototype.requestSubmit ??= function () {
    this.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  };
});
afterEach(cleanup);

describe('o campo', () => {
  it('pede oito digitos do jeito que o celular preenche sozinho', () => {
    tela();

    const c = campo();
    expect(c.getAttribute('inputmode')).toBe('numeric');
    expect(c.getAttribute('autocomplete')).toBe('one-time-code');
    expect(c.getAttribute('pattern')).toBe('[0-9]{8}');
    expect(c.maxLength).toBe(8);
    expect(botao('Confirmar').disabled).toBe(true);
  });

  // Quem cai no campo pelo leitor de tela ouve por que ele apareceu.
  it('o texto de cima descreve o campo; sem erro, nada marcado', () => {
    tela();

    expect(campo().getAttribute('aria-describedby')).toBe('codigo-intro');
    expect(document.getElementById('codigo-intro')?.textContent).toContain('maria@exemplo.com');
    expect(campo().hasAttribute('aria-invalid')).toBe(false);
  });

  it('colar "Seu código: 1234 5678" vira 12345678 e envia sozinho', async () => {
    tela();

    await digita('Seu código: 1234 5678');
    await screen.findByRole('alert');

    expect(recebidos.map((f) => f.get('codigo'))).toEqual(['12345678']);
  });

  it('com sete digitos nao envia; o botao fica desabilitado', async () => {
    tela();

    await digita('1234567');

    expect(confirmar).not.toHaveBeenCalled();
    expect(campo().value).toBe('1234567');
    expect(botao('Confirmar').disabled).toBe(true);
  });

  it('codigo errado: erro ligado ao campo, campo limpo e com foco', async () => {
    tela({ foco: false });

    await digita('00000000');
    const erro = await screen.findByRole('alert');

    expect(erro.textContent).toMatch(/inválido ou vencido/);
    expect(erro.id).toBe('codigo-erro');
    expect(campo().value).toBe('');
    expect(document.activeElement).toBe(campo());
    expect(campo().getAttribute('aria-invalid')).toBe('true');
    expect(campo().getAttribute('aria-describedby')).toBe('codigo-intro codigo-erro');
  });

  it('o foco vai para o campo quando a tela existe para ele, e so entao', () => {
    const { unmount } = tela();
    expect(document.activeElement).toBe(campo());
    unmount();

    tela({ foco: false });
    expect(document.activeElement).not.toBe(campo());
  });
});

describe('o que vai junto', () => {
  it('os campos ocultos de quem chama vao nos dois formularios', async () => {
    const { container } = tela({
      ocultos: { email: 'maria@exemplo.com', next: '/checkout?p=x', lembrar: '1' },
    });

    await digita('12345678');
    await screen.findByRole('alert');
    expect(Object.fromEntries(recebidos[0])).toMatchObject({
      email: 'maria@exemplo.com',
      next: '/checkout?p=x',
      lembrar: '1',
      codigo: '12345678',
    });

    const formularios = container.querySelectorAll('form');
    expect(formularios).toHaveLength(2);
    for (const f of formularios) {
      expect(new FormData(f).get('email')).toBe('maria@exemplo.com');
    }
  });

  it('sem ocultos, nenhum e-mail sai da tela (/conta usa o da sessao)', () => {
    const { container } = tela({ desafio: false });

    expect(container.querySelector('input[name="email"]')).toBeNull();
  });

  it('a isca vai no formulario do codigo, e no reenvio so com o desafio', () => {
    const { container, unmount } = tela();
    expect(container.querySelectorAll('input[name="website"]')).toHaveLength(2);
    unmount();

    const semDesafio = tela({ desafio: false });
    expect(semDesafio.container.querySelectorAll('input[name="website"]')).toHaveLength(1);
  });
});

describe('reenviar', () => {
  it('espera 60 s quando a tela abre: um e-mail acabou de sair', () => {
    tela();

    const b = botao(new RegExp(`Reenviar código \\(${ESPERA_REENVIO_S} s\\)`));
    expect(b.disabled).toBe(true);
  });

  it('em /conta nada saiu ainda: o botao comeca livre, sem contagem', () => {
    tela({ desafio: false, esperaInicialS: 0, rotuloDoReenvio: 'Enviar código' });

    expect(botao('Enviar código').disabled).toBe(false);
  });

  it('depois de um envio que deu certo, a contagem recomeca cheia', async () => {
    const { container } = tela({
      desafio: false,
      esperaInicialS: 0,
      rotuloDoReenvio: 'Enviar código',
    });

    await act(async () => {
      fireEvent.submit(container.querySelectorAll('form')[1]);
    });

    expect(reenviar).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Enviamos outro código.')).toBeTruthy();
    expect(botao(new RegExp(`Enviar código \\(${ESPERA_REENVIO_S} s\\)`)).disabled).toBe(true);
  });

  it('a contagem desce sozinha e libera o botao no fim', () => {
    vi.useFakeTimers();
    try {
      tela({ esperaInicialS: 2 });
      expect(botao(/Reenviar código \(2 s\)/).disabled).toBe(true);

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(botao('Reenviar código').disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('voltar', () => {
  it('o botao de voltar avisa quem chamou', () => {
    const volta = vi.fn();
    tela({ voltar: { rotulo: 'Trocar e-mail', aoClicar: volta } });

    fireEvent.click(botao('Trocar e-mail'));

    expect(volta).toHaveBeenCalledTimes(1);
  });

  it('sem voltar, nao ha botao alem dos dois da tela', () => {
    tela({ desafio: false, esperaInicialS: 0, rotuloDoReenvio: 'Enviar código' });

    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'ConfirmarConfirmando…',
      'Enviar códigoEnviando…',
    ]);
  });
});
