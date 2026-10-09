// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./acoes', () => ({ reenviarVerificacao: vi.fn() }));

import Verificacao from './Verificacao';

afterEach(cleanup);

/**
 * O aviso da conta sem e-mail confirmado (#30, #250) diz so o que o site
 * barra de verdade: comprar. A recuperacao de senha nao depende da
 * verificacao, e o aviso dizia que sim.
 */
describe('aviso de e-mail nao verificado', () => {
  it('diz que sem verificar nao da para comprar', () => {
    const { container } = render(<Verificacao />);

    expect(container.textContent).toContain('Sem isso, não dá para comprar.');
  });

  it('nao diz que a senha fica sem recuperacao', () => {
    const { container } = render(<Verificacao />);

    expect(container.textContent).not.toMatch(/recuperar a senha/i);
  });
});
