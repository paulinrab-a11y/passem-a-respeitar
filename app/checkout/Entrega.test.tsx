// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RespostaDoFrete } from './acoes';
import type { EstadoDoCheckout } from './estado';

vi.mock('./acoes', () => ({
  finalizarCompra: vi.fn(
    async (): Promise<EstadoDoCheckout> => ({
      recado: { tom: 'erro', texto: 'Confira o CEP.' },
      campo: 'cep',
    })
  ),
  cotarFrete: vi.fn(),
  buscarEndereco: vi.fn(),
}));

const { buscarEndereco, cotarFrete, finalizarCompra } = await import('./acoes');
const { default: Entrega } = await import('./Entrega');

const PAC = { servico: 'pac', nome: 'PAC', precoCentavos: 2350, prazoDias: 8 } as const;
const SEDEX = { servico: 'sedex', nome: 'SEDEX', precoCentavos: 4590, prazoDias: 3 } as const;
const COTADO: RespostaDoFrete = { ok: true, subtotalCentavos: 12000, opcoes: [PAC, SEDEX] };
const PAULISTA = {
  logradouro: 'Avenida Paulista',
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'SP',
};

const ENDERECO = {
  'Quem recebe': 'Maria Teste',
  CEP: '01310-100',
  Rua: 'Rua das Flores',
  Número: '42',
  Complemento: 'ap 3',
  Bairro: 'Centro',
  Cidade: 'São Paulo',
  UF: 'SP',
};

const campo = (rotulo: string) => screen.getByLabelText(rotulo) as HTMLInputElement;
const botao = () => screen.getByRole('button') as HTMLButtonElement;
const reais = (texto: string) => texto.replace(/\s/g, ' ');

function monta() {
  return render(
    <Entrega slug="camiseta-cbac" tamanho="M" quantidade={1} subtotalCentavos={12000} />
  );
}

/** Digita o CEP e espera a cotacao chegar. */
async function digitaCep(cep: string) {
  await act(async () => {
    fireEvent.change(campo('CEP'), { target: { value: cep } });
  });
}

/** Uma promessa que o teste resolve quando quiser: a cotacao "em voo". */
function emVoo() {
  let solta: (r: RespostaDoFrete) => void = () => {};
  const promessa = new Promise<RespostaDoFrete>((r) => {
    solta = r;
  });
  return { promessa, solta };
}

beforeEach(() => {
  vi.mocked(cotarFrete).mockReset();
  vi.mocked(cotarFrete).mockResolvedValue(COTADO);
  vi.mocked(buscarEndereco).mockReset();
  vi.mocked(buscarEndereco).mockResolvedValue(PAULISTA);
  vi.mocked(finalizarCompra).mockClear();
});

afterEach(cleanup);

describe('Entrega (#130)', () => {
  it('errar o CEP mantem os oito campos preenchidos', async () => {
    const { container } = monta();

    for (const [rotulo, valor] of Object.entries(ENDERECO)) {
      await act(async () => {
        fireEvent.change(campo(rotulo), { target: { value: valor } });
      });
    }

    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    });
    await screen.findByText('Confira o CEP.');

    for (const [rotulo, valor] of Object.entries(ENDERECO)) {
      expect(campo(rotulo).value, rotulo).toBe(valor);
    }
    expect(campo('CEP').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('frete (#199)', () => {
  it('antes do CEP: diz o que fazer, nao cota, e nao deixa finalizar', () => {
    monta();

    expect(screen.getByText('Digite o CEP para ver o preço do PAC e do SEDEX.')).toBeTruthy();
    expect(cotarFrete).not.toHaveBeenCalled();
    expect(botao().disabled).toBe(true);
    expect(botao().textContent).toContain('Informe o CEP');
  });

  it('CEP pela metade nao gasta consulta', async () => {
    monta();
    await digitaCep('0131010');

    expect(cotarFrete).not.toHaveBeenCalled();
  });

  it('CEP completo cota com a escolha e o CEP, e nada de preco', async () => {
    monta();
    await digitaCep('01310-100');

    expect(cotarFrete).toHaveBeenCalledTimes(1);
    expect(vi.mocked(cotarFrete).mock.calls[0][0]).toEqual({
      slug: 'camiseta-cbac',
      tamanho: 'M',
      quantidade: 1,
      cep: '01310100',
    });
  });

  it('mostra PAC e SEDEX com preco e prazo, e marca o mais barato', async () => {
    monta();
    await digitaCep('01310100');

    const pac = screen.getByRole('radio', { name: /PAC/ }) as HTMLInputElement;
    const sedex = screen.getByRole('radio', { name: /SEDEX/ }) as HTMLInputElement;

    expect(pac.checked).toBe(true);
    expect(sedex.checked).toBe(false);
    expect(reais(pac.closest('label')?.textContent ?? '')).toContain('até 8 dias úteis');
    expect(reais(pac.closest('label')?.textContent ?? '')).toContain('R$ 23,50');
    expect(reais(sedex.closest('label')?.textContent ?? '')).toContain('até 3 dias úteis');
    expect(reais(botao().textContent ?? '')).toContain('Finalizar — R$ 143,50');
    expect(botao().disabled).toBe(false);
  });

  it('escolher SEDEX muda o total e o botao', async () => {
    monta();
    await digitaCep('01310100');

    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /SEDEX/ }));
    });

    expect(reais(botao().textContent ?? '')).toContain('Finalizar — R$ 165,90');
    expect(reais(document.querySelector('.resumo')?.textContent ?? '')).toContain(
      'SEDEX · R$ 45,90'
    );
  });

  it('o formulario manda o servico escolhido', async () => {
    const { container } = monta();
    await digitaCep('01310100');
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /SEDEX/ }));
    });

    const dados = new FormData(container.querySelector('form') as HTMLFormElement);
    expect(dados.get('servico')).toBe('sedex');
    // E so isso: nenhum campo com preco de frete.
    expect([...dados.keys()].filter((k) => /frete|preco|total/i.test(k))).toEqual([]);
  });

  it('enquanto cota, a caixa mostra o esqueleto e o botao espera', async () => {
    const voo = emVoo();
    vi.mocked(cotarFrete).mockReturnValue(voo.promessa);
    const { container } = monta();

    await digitaCep('01310100');

    expect(container.querySelectorAll('.frete-esqueleto')).toHaveLength(2);
    expect(container.querySelector('.frete')?.getAttribute('aria-busy')).toBe('true');
    expect(botao().disabled).toBe(true);
    expect(botao().textContent).toContain('Aguardando o frete');

    await act(async () => voo.solta(COTADO));
    expect(container.querySelectorAll('.frete-esqueleto')).toHaveLength(0);
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('cotacao que falha diz o motivo e nao deixa finalizar', async () => {
    vi.mocked(cotarFrete).mockResolvedValue({
      ok: false,
      texto: 'Não consegui calcular o frete agora. Tente de novo em instantes.',
    });
    monta();
    await digitaCep('01310100');

    expect(screen.getByRole('alert').textContent).toBe(
      'Não consegui calcular o frete agora. Tente de novo em instantes.'
    );
    expect(botao().disabled).toBe(true);
    // Com o CEP preenchido, pedir o CEP de novo seria mandar fazer o que ja foi feito.
    expect(botao().textContent).toContain('Frete indisponível');
  });

  it('apagar um digito tira o frete da tela', async () => {
    monta();
    await digitaCep('01310100');
    expect(screen.getAllByRole('radio')).toHaveLength(2);

    await digitaCep('0131010');

    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(botao().disabled).toBe(true);
  });

  it('a resposta de um CEP velho nao toma o lugar da do novo', async () => {
    const velho = emVoo();
    const novo = emVoo();
    vi.mocked(cotarFrete).mockReturnValueOnce(velho.promessa).mockReturnValueOnce(novo.promessa);
    monta();

    await digitaCep('01310100');
    await digitaCep('20040002');

    await act(async () =>
      novo.solta({ ok: true, subtotalCentavos: 12000, opcoes: [{ ...PAC, precoCentavos: 3100 }] })
    );
    await act(async () => velho.solta(COTADO));

    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(reais(botao().textContent ?? '')).toContain('R$ 151,00');
  });

  it('o mesmo CEP de novo nao cota de novo', async () => {
    monta();
    await digitaCep('01310100');
    await digitaCep('01310-100');

    expect(cotarFrete).toHaveBeenCalledTimes(1);
  });

  it('a escolha sobrevive a troca de CEP quando o servico continua existindo', async () => {
    monta();
    await digitaCep('01310100');
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /SEDEX/ }));
    });

    await digitaCep('20040002');

    expect((screen.getByRole('radio', { name: /SEDEX/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('servico que o CEP novo nao tem cai para o que tem', async () => {
    monta();
    await digitaCep('01310100');
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /SEDEX/ }));
    });

    vi.mocked(cotarFrete).mockResolvedValue({ ok: true, subtotalCentavos: 12000, opcoes: [PAC] });
    await digitaCep('69900000');

    expect((screen.getByRole('radio', { name: /PAC/ }) as HTMLInputElement).checked).toBe(true);
    expect(reais(botao().textContent ?? '')).toContain('R$ 143,50');
  });

  it('diz que o transporte vem depois dos 30 dias de producao', () => {
    monta();

    expect(
      screen.getByText(/O transporte começa depois da produção, de pelo menos 30 dias/)
    ).toBeTruthy();
  });
});

describe('endereco pelo CEP (#204)', () => {
  it('CEP completo preenche rua, bairro, cidade e UF', async () => {
    monta();
    await digitaCep('01310-100');

    expect(buscarEndereco).toHaveBeenCalledWith('01310100');
    expect(campo('Rua').value).toBe('Avenida Paulista');
    expect(campo('Bairro').value).toBe('Bela Vista');
    expect(campo('Cidade').value).toBe('São Paulo');
    expect(campo('UF').value).toBe('SP');
    // O que a pessoa escreve a mao continua dela.
    expect(campo('Número').value).toBe('');
    expect(campo('Quem recebe').value).toBe('');
  });

  it('CEP pela metade nao busca', async () => {
    monta();
    await digitaCep('0131010');
    expect(buscarEndereco).not.toHaveBeenCalled();
  });

  it('o mesmo CEP de novo nao busca de novo', async () => {
    monta();
    await digitaCep('01310100');
    await digitaCep('01310-100');
    expect(buscarEndereco).toHaveBeenCalledTimes(1);
  });

  it('sem resposta, o que a pessoa digitou fica, e nenhum erro aparece', async () => {
    vi.mocked(buscarEndereco).mockResolvedValue(null);
    monta();
    fireEvent.change(campo('Rua'), { target: { value: 'Rua Minha' } });
    await digitaCep('99999999');

    expect(campo('Rua').value).toBe('Rua Minha');
    expect(campo('Cidade').value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('CEP geral traz so cidade e UF, e nao apaga a rua que a pessoa escreveu', async () => {
    vi.mocked(buscarEndereco).mockResolvedValue({
      logradouro: '',
      bairro: '',
      cidade: 'Lábrea',
      uf: 'AM',
    });
    monta();
    fireEvent.change(campo('Rua'), { target: { value: 'Rua Minha' } });
    await digitaCep('69999000');

    expect(campo('Rua').value).toBe('Rua Minha');
    expect(campo('Cidade').value).toBe('Lábrea');
    expect(campo('UF').value).toBe('AM');
  });

  it('trocar o CEP troca o endereco', async () => {
    monta();
    await digitaCep('01310100');
    vi.mocked(buscarEndereco).mockResolvedValue({
      logradouro: 'Rua Augusta',
      bairro: 'Consolação',
      cidade: 'São Paulo',
      uf: 'SP',
    });
    await digitaCep('01305000');

    expect(campo('Rua').value).toBe('Rua Augusta');
    expect(campo('Bairro').value).toBe('Consolação');
  });

  it('a resposta de um CEP velho nao enche o formulario', async () => {
    let soltaVelho: (e: typeof PAULISTA | null) => void = () => {};
    vi.mocked(buscarEndereco)
      .mockReturnValueOnce(
        new Promise((r) => {
          soltaVelho = r;
        })
      )
      .mockResolvedValueOnce({
        logradouro: 'Rua Augusta',
        bairro: 'Consolação',
        cidade: 'São Paulo',
        uf: 'SP',
      });
    monta();
    await digitaCep('01310100');
    await digitaCep('01305000');
    expect(campo('Rua').value).toBe('Rua Augusta');

    await act(async () => soltaVelho(PAULISTA));
    expect(campo('Rua').value).toBe('Rua Augusta');
  });

  it('com o foco no CEP, o foco vai para o numero quando o endereco chega', async () => {
    monta();
    campo('CEP').focus();
    await digitaCep('01310100');
    expect(document.activeElement).toBe(campo('Número'));
  });

  it('com o foco em outro lugar, o foco fica onde esta', async () => {
    monta();
    campo('Quem recebe').focus();
    await digitaCep('01310100');
    expect(document.activeElement).toBe(campo('Quem recebe'));
  });
});
