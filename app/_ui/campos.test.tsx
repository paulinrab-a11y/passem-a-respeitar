// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useActionState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useCaixinha, useCampos } from './campos';

/**
 * O defeito e a cura, lado a lado (Issue #130).
 *
 * O formulario abaixo tem um campo do DOM e um campo do `useCampos`, e uma
 * acao que sempre responde com erro. O primeiro `it` e o que prova que o teste
 * enxerga o problema: se o React deixar de resetar campo nao-controlado, ele
 * cai e avisa que o helper deixou de ser necessario.
 */
type Estado = { erro: string | null };

async function sempreErra(): Promise<Estado> {
  return { erro: 'CEP inválido' };
}

function Formulario() {
  const [estado, acao] = useActionState(sempreErra, { erro: null });
  const { valores, campo, limpar } = useCampos({ rua: '', cep: '' });
  const { marcada, caixinha } = useCaixinha();

  return (
    <form action={acao} data-testid="form">
      <input aria-label="solto" name="solto" type="text" />
      <input aria-label="rua" type="text" {...campo('rua')} />
      <input aria-label="cep" type="text" {...campo('cep')} />
      <input aria-label="aceite" name="aceite" type="checkbox" {...caixinha} />
      <span data-testid="marcada">{String(marcada)}</span>
      <output>{JSON.stringify(valores)}</output>
      {estado.erro ? <p role="alert">{estado.erro}</p> : null}
      <button type="button" onClick={() => limpar('cep')}>
        limpar cep
      </button>
      <button type="button" onClick={() => limpar()}>
        limpar tudo
      </button>
    </form>
  );
}

const campoDe = (rotulo: string) => screen.getByLabelText(rotulo) as HTMLInputElement;
const digita = (rotulo: string, valor: string) =>
  fireEvent.change(campoDe(rotulo), { target: { value: valor } });

async function enviaEEsperaOErro() {
  await act(async () => {
    fireEvent.submit(screen.getByTestId('form'));
  });
  await screen.findByRole('alert');
}

afterEach(cleanup);

describe('useCampos', () => {
  it('o defeito existe: campo nao-controlado volta vazio quando a acao responde com erro', async () => {
    render(<Formulario />);
    digita('solto', 'Rua das Flores');

    await enviaEEsperaOErro();

    expect(campoDe('solto').value).toBe('');
  });

  it('campo controlado continua preenchido quando a acao responde com erro', async () => {
    render(<Formulario />);
    digita('rua', 'Rua das Flores');
    digita('cep', '0000');

    await enviaEEsperaOErro();

    expect(campoDe('rua').value).toBe('Rua das Flores');
    expect(campoDe('cep').value).toBe('0000');
  });

  it('caixinha marcada continua marcada quando a acao responde com erro', async () => {
    render(<Formulario />);
    fireEvent.click(campoDe('aceite'));

    await enviaEEsperaOErro();

    expect(campoDe('aceite').checked).toBe(true);
    expect(screen.getByTestId('marcada').textContent).toBe('true');
  });

  it('caixinha desmarcada de novo continua desmarcada', async () => {
    render(<Formulario />);
    fireEvent.click(campoDe('aceite'));
    fireEvent.click(campoDe('aceite'));

    await enviaEEsperaOErro();

    expect(campoDe('aceite').checked).toBe(false);
    expect(screen.getByTestId('marcada').textContent).toBe('false');
  });

  it('entrega name, value e onChange para espalhar no input', () => {
    render(<Formulario />);

    expect(campoDe('rua').name).toBe('rua');
    digita('rua', 'Av. Brasil');
    expect(campoDe('rua').value).toBe('Av. Brasil');
    expect(screen.getByRole('status').textContent).toBe('{"rua":"Av. Brasil","cep":""}');
  });

  it('limpar com nomes esvazia so os citados', () => {
    render(<Formulario />);
    digita('rua', 'Av. Brasil');
    digita('cep', '01310-100');

    fireEvent.click(screen.getByText('limpar cep'));

    expect(campoDe('rua').value).toBe('Av. Brasil');
    expect(campoDe('cep').value).toBe('');
  });

  it('limpar sem nomes esvazia todos', () => {
    render(<Formulario />);
    digita('rua', 'Av. Brasil');
    digita('cep', '01310-100');

    fireEvent.click(screen.getByText('limpar tudo'));

    expect(campoDe('rua').value).toBe('');
    expect(campoDe('cep').value).toBe('');
  });
});
