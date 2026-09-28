// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEMPO_NA_TELA } from '@/app/_ui/saida-automatica';
import type { EstadoSenha } from './estado';

const resposta = vi.hoisted(() => ({ tom: 'erro' as 'ok' | 'erro' }));

vi.mock('./acoes', () => ({
  trocarSenha: vi.fn(
    async (anterior: EstadoSenha): Promise<EstadoSenha> => ({
      recado: {
        tom: resposta.tom,
        texto: resposta.tom === 'ok' ? 'Senha trocada.' : 'Senha atual incorreta.',
      },
      campo: resposta.tom === 'ok' ? null : 'atual',
      tentativa: anterior.tentativa + 1,
    })
  ),
}));

import TrocarSenha from './TrocarSenha';

const campo = (rotulo: string) => screen.getByLabelText(rotulo) as HTMLInputElement;

async function preencheEEnvia(container: HTMLElement) {
  fireEvent.change(campo('Senha atual'), { target: { value: 'senha-antiga-1' } });
  fireEvent.change(campo('Nova senha'), { target: { value: 'senha-nova-longa-2' } });
  fireEvent.change(campo('Confirmar nova senha'), { target: { value: 'senha-nova-longa-2' } });

  await act(async () => {
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
  });
  // Erro interrompe (`alert`); sucesso espera a vez (`status`). (#51)
  await screen.findByRole(resposta.tom === 'ok' ? 'status' : 'alert');
}

beforeEach(() => {
  resposta.tom = 'erro';
});

afterEach(cleanup);

describe('troca de senha (#130)', () => {
  it('erro mantem os tres campos, sem nada vir do servidor', async () => {
    const { container } = render(<TrocarSenha />);

    await preencheEEnvia(container);

    expect(campo('Senha atual').value).toBe('senha-antiga-1');
    expect(campo('Nova senha').value).toBe('senha-nova-longa-2');
    expect(campo('Confirmar nova senha').value).toBe('senha-nova-longa-2');
  });

  it('sucesso esvazia os tres: senha trocada nao fica parada na tela', async () => {
    resposta.tom = 'ok';
    const { container } = render(<TrocarSenha />);

    await preencheEEnvia(container);

    expect(campo('Senha atual').value).toBe('');
    expect(campo('Nova senha').value).toBe('');
    expect(campo('Confirmar nova senha').value).toBe('');
  });
});

describe('troca de senha (#51)', () => {
  it('erro marca o campo que errou, liga ao aviso e leva o foco ate ele', async () => {
    const { container } = render(<TrocarSenha />);

    await preencheEEnvia(container);
    const aviso = await screen.findByRole('alert');

    expect(campo('Senha atual').getAttribute('aria-invalid')).toBe('true');
    expect(campo('Senha atual').getAttribute('aria-describedby')).toBe(aviso.id);
    expect(document.activeElement).toBe(campo('Senha atual'));
    // Os outros dois nao erraram.
    expect(campo('Nova senha').hasAttribute('aria-invalid')).toBe(false);
    expect(campo('Confirmar nova senha').hasAttribute('aria-invalid')).toBe(false);
  });

  it('o medidor de senha continua descrevendo o campo, com ou sem erro', () => {
    render(<TrocarSenha />);

    expect(campo('Nova senha').getAttribute('aria-describedby')).toBe('forca-da-senha');
  });

  it('sucesso e aviso que espera a vez, nao alerta', async () => {
    resposta.tom = 'ok';
    const { container } = render(<TrocarSenha />);

    fireEvent.change(campo('Senha atual'), { target: { value: 'senha-antiga-1' } });
    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    });

    expect((await screen.findByRole('status')).id).toBe('aviso-da-senha');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('toast da troca de senha (#136)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const passa = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

  // Sem o `findByRole` do bloco de cima: ele espera com o relogio, e o
  // relogio aqui esta parado. O `act` assincrono ja resolve a acao.
  async function enviaComErro(container: HTMLElement) {
    fireEvent.change(campo('Senha atual'), { target: { value: 'senha-antiga-1' } });
    fireEvent.change(campo('Nova senha'), { target: { value: 'senha-nova-longa-2' } });
    fireEvent.change(campo('Confirmar nova senha'), { target: { value: 'senha-nova-longa-2' } });

    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    });
    expect(screen.getByRole('alert').textContent).toContain('Senha atual incorreta.');
  }

  // Antes o erro so saia no "x" e ficava em cima do fim da pagina.
  it('o erro sai sozinho, sem ninguem clicar no "x"', async () => {
    const { container } = render(<TrocarSenha />);
    await enviaComErro(container);

    passa(TEMPO_NA_TELA.erro - 1);
    expect(screen.queryByRole('alert')).not.toBeNull();

    // O prazo de tela e depois o do desmonte animado.
    passa(1 + 400);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('o erro nao sai com o ponteiro em cima', async () => {
    const { container } = render(<TrocarSenha />);
    await enviaComErro(container);

    act(() => void fireEvent.mouseEnter(screen.getByRole('alert')));
    passa(TEMPO_NA_TELA.erro * 3);

    expect(screen.queryByRole('alert')).not.toBeNull();
  });

  it('o erro nao sai com o foco no botao de fechar', async () => {
    const { container } = render(<TrocarSenha />);
    await enviaComErro(container);

    act(() => void fireEvent.focus(screen.getByLabelText('Fechar aviso')));
    passa(TEMPO_NA_TELA.erro * 3);

    expect(screen.queryByRole('alert')).not.toBeNull();
  });

  it('o erro sair nao apaga o que foi digitado', async () => {
    const { container } = render(<TrocarSenha />);
    await enviaComErro(container);

    passa(TEMPO_NA_TELA.erro + 400);

    expect(campo('Senha atual').value).toBe('senha-antiga-1');
    expect(campo('Nova senha').value).toBe('senha-nova-longa-2');
  });

  // O campo aponta para o aviso por aria-describedby (#51). Quando o aviso
  // sai, o campo continua marcado, mas nao pode apontar para o que sumiu.
  it('depois que o aviso sai, o campo continua marcado como errado', async () => {
    const { container } = render(<TrocarSenha />);
    await enviaComErro(container);

    passa(TEMPO_NA_TELA.erro + 400);

    expect(campo('Senha atual').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('lugar do toast (#136)', () => {
  const css = readFileSync('app/globals.css', 'utf8');

  it('em tela larga vai para o canto, fora da coluna de conteudo', () => {
    expect(css).toMatch(/@media \(min-width:1280px\)\{\s*\.toast\{left:auto;margin-inline:0;/);
  });

  it('em tela estreita a pagina termina com espaco para rolar acima dele', () => {
    expect(css).toMatch(
      /@media \(max-width:1279px\)\{\s*\.auth\.conta\.com-toast\{padding-bottom:160px\}/
    );
  });

  it('o recuo do toast pesa mais que o da area de conta ancorada no topo', () => {
    // As duas regras definem padding-bottom. A da #46 vem depois no arquivo;
    // a do toast so ganha se tiver um nome de classe a mais.
    expect(css).toContain('.auth.conta{place-items:start center;');
    expect(css).not.toMatch(/\.auth\.com-toast\{padding-bottom/);
  });

  it('a tela de seguranca e a que tem toast', () => {
    expect(readFileSync('app/conta/seguranca/page.tsx', 'utf8')).toContain(
      '<main className="auth conta com-toast">'
    );
  });
});
