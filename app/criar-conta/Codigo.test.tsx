// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EstadoCodigo } from '@/app/_ui/estado-do-codigo';

/**
 * A tela do codigo do cadastro (#224). O campo, o envio sozinho e a espera do
 * reenvio sao do `CodigoDeConfirmacao` e tem teste la; aqui fica o que e do
 * cadastro: o texto que nao conta se o e-mail tem conta, o e-mail indo junto,
 * a senha indo so com o codigo (#284), o caminho de entrar e o de trocar o
 * e-mail.
 */
let recebidos: FormData[] = [];
let resposta: (anterior: EstadoCodigo) => EstadoCodigo;

const confirmarCadastro = vi.fn(async (anterior: EstadoCodigo, form: FormData) => {
  recebidos.push(form);
  return resposta(anterior);
});
const reenviarCodigo = vi.fn(async (anterior: { tentativa: number }, form: FormData) => {
  recebidos.push(form);
  return { erro: null, aviso: 'Enviamos.', reenviadoEm: Date.now(), tentativa: anterior.tentativa };
});
vi.mock('./acoes', () => ({
  confirmarCadastro: (a: EstadoCodigo, f: FormData) => confirmarCadastro(a, f),
  reenviarCodigo: (a: { tentativa: number }, f: FormData) => reenviarCodigo(a, f),
}));

import Codigo from './Codigo';

// Inventada, e longa o bastante para nao aparecer por acaso em outro texto.
const SENHA = 'senha-da-maria-de-teste';

function tela(aoTrocarEmail = () => {}) {
  return render(
    <Codigo
      email="maria@exemplo.com"
      senha={SENHA}
      confirmacao={SENHA}
      aoTrocarEmail={aoTrocarEmail}
    />
  );
}

async function digita(valor: string) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(/Código de 8 dígitos/), { target: { value: valor } });
  });
}

beforeEach(() => {
  recebidos = [];
  vi.clearAllMocks();
  resposta = (anterior) => ({ erro: 'Código inválido.', tentativa: anterior.tentativa + 1 });
  // requestSubmit nao existe no jsdom: vira um submit normal do formulario.
  HTMLFormElement.prototype.requestSubmit ??= function () {
    this.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  };
});
afterEach(cleanup);

describe('tela do codigo do cadastro (#224)', () => {
  it('diz "se for válido": a tela e a mesma para e-mail novo e repetido', () => {
    tela();

    expect(screen.getByText('Confira seu e-mail')).toBeTruthy();
    expect(screen.getByText('maria@exemplo.com')).toBeTruthy();
    expect(document.getElementById('codigo-intro')?.textContent).toMatch(
      /Se maria@exemplo\.com for válido, enviamos um código de 8 dígitos/
    );
  });

  it('o e-mail vai junto no codigo e no reenvio', () => {
    const { container } = tela();

    for (const f of container.querySelectorAll('form')) {
      expect(new FormData(f).get('email')).toBe('maria@exemplo.com');
    }
  });

  it('oferece entrar, para quem ja tinha conta com esse e-mail', () => {
    tela();

    expect(screen.getByRole('link', { name: 'Entrar' }).getAttribute('href')).toBe('/entrar');
  });

  // A tela some ao recarregar ou fechar a aba, e a senha que o codigo
  // gravaria vai junto. A volta e o login com a senha (#260).
  it('ensina a volta pelo login, para quem sair antes de confirmar', () => {
    tela();

    expect(
      screen.getByText(
        'Se sair desta tela antes de confirmar, entre com a senha que escolheu: mandamos um código novo.'
      ).className
    ).toBe('auth-rodape');
  });

  it('trocar e-mail avisa o formulario', () => {
    const volta = vi.fn();
    tela(volta);

    fireEvent.click(screen.getByRole('button', { name: 'Trocar e-mail' }));

    expect(volta).toHaveBeenCalledTimes(1);
  });
});

/**
 * A senha escolhida volta com o codigo e e gravada na conta (#284). Ela vem
 * do estado do formulario e entra no envio na hora: nao vira campo da
 * pagina, nao vai no reenvio e nao fica guardada no navegador.
 */
describe('a senha vai com o codigo, e so com ele (#284)', () => {
  it('o codigo leva a senha e a confirmacao, junto com o e-mail', async () => {
    tela();

    await digita('12345678');
    await screen.findByRole('alert');

    expect(confirmarCadastro).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(recebidos[0])).toMatchObject({
      email: 'maria@exemplo.com',
      codigo: '12345678',
      senha: SENHA,
      confirmacao: SENHA,
    });
  });

  it('a senha nao esta na pagina: nem campo, nem atributo, nem texto', () => {
    const { container } = tela();

    expect(container.querySelector('input[name="senha"]')).toBeNull();
    expect(container.querySelector('input[name="confirmacao"]')).toBeNull();
    expect(container.innerHTML).not.toContain(SENHA);
  });

  it('o reenvio nao leva a senha', async () => {
    const { container } = tela();
    const reenvio = container.querySelectorAll('form')[1];

    await act(async () => {
      fireEvent.submit(reenvio);
    });

    expect(reenviarCodigo).toHaveBeenCalledTimes(1);
    const enviado = recebidos[0];
    expect(enviado.get('email')).toBe('maria@exemplo.com');
    expect(enviado.get('senha')).toBeNull();
    expect(enviado.get('confirmacao')).toBeNull();
  });

  it('nada vai para o armazenamento do navegador', async () => {
    tela();

    await digita('12345678');
    await screen.findByRole('alert');

    const guardado = [localStorage, sessionStorage].flatMap((s) =>
      Object.keys(s).map((k) => s.getItem(k) ?? '')
    );
    expect(guardado.join('\n')).not.toContain(SENHA);
    expect(document.cookie).not.toContain(SENHA);
  });
});
