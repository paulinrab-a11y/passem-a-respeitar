// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fimDaAnimacao } from '@/app/_ui/fim-da-animacao';
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
const { esqueceCep, lembraCep } = await import('@/app/_home/cep-lembrado');
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
/** O de finalizar. Pelo tipo: a caixa do frete pode ter o de tentar de novo. */
const botao = () => document.querySelector('button[type="submit"]') as HTMLButtonElement;
const tentar = () => screen.queryByRole('button', { name: 'Tentar de novo' });
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
  esqueceCep();
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

describe('erro do servidor (#47)', () => {
  const vaga = () => document.querySelector('.entrega > .erro-vaga') as HTMLElement;
  const finalizar = async (form: HTMLFormElement) => {
    await act(async () => {
      fireEvent.submit(form);
    });
  };

  it('o lugar do recado existe vazio desde o primeiro quadro, entre o total e o botao', () => {
    const { container } = monta();
    const filhos = [...(container.querySelector('form') as HTMLFormElement).children];

    expect(vaga()).toBeTruthy();
    expect(vaga().children).toHaveLength(0);
    expect(filhos.indexOf(vaga())).toBe(filhos.indexOf(botao()) - 1);
    expect(filhos.indexOf(vaga())).toBe(
      filhos.indexOf(container.querySelector('.resumo') as Element) + 1
    );
  });

  it('sem erro, nenhum campo se diz invalido nem aponta para o recado', () => {
    const { container } = monta();

    for (const input of container.querySelectorAll('input:not([type="hidden"])')) {
      expect(input.hasAttribute('aria-invalid'), input.getAttribute('name') ?? '').toBe(false);
      expect(input.hasAttribute('aria-describedby'), input.getAttribute('name') ?? '').toBe(false);
    }
  });

  it('o campo que errou aponta para o recado, que entra no lugar reservado', async () => {
    const { container } = monta();
    await finalizar(container.querySelector('form') as HTMLFormElement);
    const recado = await screen.findByRole('alert');

    expect(recado.id).toBe('erro-entrega');
    expect(recado.textContent).toBe('Confira o CEP.');
    expect(recado.parentElement).toBe(vaga());
    expect(campo('CEP').getAttribute('aria-invalid')).toBe('true');
    expect(campo('CEP').getAttribute('aria-describedby')).toBe('erro-entrega');
    // So o que errou: os outros sete nao ganham descricao de um erro que nao e deles.
    expect(campo('Rua').hasAttribute('aria-describedby')).toBe(false);
    expect(campo('Rua').hasAttribute('aria-invalid')).toBe(false);
  });

  it('servico que faltou: os radios do frete apontam para o recado', async () => {
    vi.mocked(finalizarCompra).mockResolvedValueOnce({
      recado: { tom: 'erro', texto: 'Escolha o tipo de envio.' },
      campo: 'servico',
    });
    const { container } = monta();
    await digitaCep('01310100');
    await finalizar(container.querySelector('form') as HTMLFormElement);
    await screen.findByText('Escolha o tipo de envio.');

    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.getAttribute('aria-invalid')).toBe('true');
      expect(radio.getAttribute('aria-describedby')).toBe('erro-entrega');
    }
    expect(campo('CEP').hasAttribute('aria-describedby')).toBe(false);
  });

  it('no reenvio o erro antigo sai, o lugar fica, e a resposta nova entra nele', async () => {
    const { container } = monta();
    const form = container.querySelector('form') as HTMLFormElement;
    await finalizar(form);
    const antigo = await screen.findByRole('alert');

    let responde: (e: EstadoDoCheckout) => void = () => {};
    vi.mocked(finalizarCompra).mockReturnValueOnce(
      new Promise((r) => {
        responde = r;
      })
    );
    await finalizar(form);

    // Ainda no ar: o recado do envio anterior ja nao fala deste.
    expect(antigo.className).toContain('saindo');
    fimDaAnimacao(antigo);
    expect(vaga().children).toHaveLength(0);
    expect(vaga().isConnected).toBe(true);

    await act(async () =>
      responde({ recado: { tom: 'erro', texto: 'Confira o CEP.' }, campo: 'cep' })
    );

    const novo = await screen.findByRole('alert');
    expect(novo).not.toBe(antigo);
    expect(novo.id).toBe('erro-entrega');
    expect(novo.parentElement).toBe(vaga());
  });

  it('todo campo de texto tem rotulo escrito, e nenhum usa placeholder', () => {
    const { container } = monta();
    const campos = [...container.querySelectorAll('input[type="text"]')];

    expect(campos).toHaveLength(8);
    for (const input of campos) {
      expect(input.closest('label')?.querySelector('span')?.textContent?.trim()).toBeTruthy();
      expect(input.hasAttribute('placeholder')).toBe(false);
    }
  });
});

describe('frete (#199)', () => {
  it('antes do CEP: diz o que fazer, nao cota, e nao deixa finalizar', () => {
    monta();

    expect(screen.getByText('Digite o CEP para ver o frete dos Correios.')).toBeTruthy();
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
      transitorio: true,
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

describe('falha da cotacao (#240)', () => {
  const FORA_DO_AR = 'Não consegui calcular o frete agora. Tente de novo em instantes.';
  const PASSAGEIRA: RespostaDoFrete = { ok: false, texto: FORA_DO_AR, transitorio: true };
  const DEFINITIVA: RespostaDoFrete = {
    ok: false,
    texto: 'Confira o CEP: não encontrei esse endereço.',
    transitorio: false,
  };

  // A chamada e um fetch. Antes, a rejeicao dentro da transition derrubava o
  // checkout no global-error, com o endereco digitado junto (#27).
  it('chamada que rejeita vira o recado de fora do ar, com tentar de novo, e o formulario fica', async () => {
    vi.mocked(cotarFrete).mockRejectedValue(new TypeError('fetch failed'));
    const { container } = monta();
    fireEvent.change(campo('Quem recebe'), { target: { value: 'Maria Teste' } });
    await digitaCep('01310100');

    expect(screen.getByRole('alert').textContent).toBe(FORA_DO_AR);
    expect(tentar()).toBeTruthy();
    expect(container.querySelectorAll('.frete-esqueleto')).toHaveLength(0);
    expect(container.querySelector('.frete')?.getAttribute('aria-busy')).toBeNull();
    expect(botao().disabled).toBe(true);
    expect(botao().textContent).toContain('Frete indisponível');
    expect(campo('Quem recebe').value).toBe('Maria Teste');
    expect(campo('CEP').value).toBe('01310100');
  });

  it('busca de endereco que rejeita nao quebra nada: a pessoa digita', async () => {
    vi.mocked(buscarEndereco).mockRejectedValue(new TypeError('fetch failed'));
    monta();
    fireEvent.change(campo('Rua'), { target: { value: 'Rua Minha' } });
    await digitaCep('01310100');

    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(campo('Rua').value).toBe('Rua Minha');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('tentar de novo cota o mesmo CEP de novo, com o esqueleto no lugar do botao', async () => {
    vi.mocked(cotarFrete).mockRejectedValueOnce(new TypeError('fetch failed'));
    const { container } = monta();
    await digitaCep('01310100');
    expect(tentar()).toBeTruthy();

    const voo = emVoo();
    vi.mocked(cotarFrete).mockReturnValueOnce(voo.promessa);
    await act(async () => {
      fireEvent.click(tentar() as HTMLButtonElement);
    });

    expect(cotarFrete).toHaveBeenCalledTimes(2);
    expect(vi.mocked(cotarFrete).mock.calls[1][0]).toEqual(vi.mocked(cotarFrete).mock.calls[0][0]);
    expect(container.querySelectorAll('.frete-esqueleto')).toHaveLength(2);
    expect(container.querySelector('.frete')?.getAttribute('aria-busy')).toBe('true');
    expect(tentar()).toBeNull();
    expect(botao().textContent).toContain('Aguardando o frete');

    await act(async () => voo.solta(COTADO));
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(botao().disabled).toBe(false);
  });

  it('depois de falha passageira, apagar e redigitar o mesmo CEP cota de novo', async () => {
    vi.mocked(cotarFrete).mockResolvedValueOnce(PASSAGEIRA);
    monta();
    await digitaCep('01310100');
    expect(screen.getByRole('alert').textContent).toBe(FORA_DO_AR);

    await digitaCep('0131010');
    expect(screen.queryByRole('alert')).toBeNull();
    await digitaCep('01310100');

    expect(cotarFrete).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('a falha passageira fica enquanto o CEP esta no campo: nada de cotar sozinho', async () => {
    vi.mocked(cotarFrete).mockResolvedValue(PASSAGEIRA);
    monta();
    await digitaCep('01310100');
    // Mais ciclos de efeito: um loop apareceria aqui.
    await act(async () => {});
    await act(async () => {});

    expect(cotarFrete).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toBe(FORA_DO_AR);
  });

  it('recusa definitiva fica: sem tentar de novo, e redigitar o mesmo CEP nao consulta', async () => {
    vi.mocked(cotarFrete).mockResolvedValue(DEFINITIVA);
    monta();
    await digitaCep('99999999');
    expect(screen.getByRole('alert').textContent).toBe(DEFINITIVA.texto);
    expect(tentar()).toBeNull();

    await digitaCep('9999999');
    await digitaCep('99999999');

    expect(cotarFrete).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toBe(DEFINITIVA.texto);
  });

  // O pendente do `useTransition` valia para qualquer cotacao no ar (#31).
  it('a cotacao lenta do CEP errado nao segura o esqueleto do CEP certo', async () => {
    const errado = emVoo();
    const certo = emVoo();
    vi.mocked(cotarFrete).mockReturnValueOnce(errado.promessa).mockReturnValueOnce(certo.promessa);
    const { container } = monta();

    await digitaCep('01310101');
    await digitaCep('01310100');
    await act(async () => certo.solta(COTADO));

    // A do CEP errado ainda esta no ar — e nao importa.
    expect(container.querySelectorAll('.frete-esqueleto')).toHaveLength(0);
    expect(container.querySelector('.frete')?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(botao().disabled).toBe(false);
    expect(reais(botao().textContent ?? '')).toContain('Finalizar — R$ 143,50');

    await act(async () => errado.solta(DEFINITIVA));
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('recusa do frete na criacao do pedido (#265)', () => {
  const RECALCULADO =
    'Esse envio não atende mais esse CEP. Recalculamos o frete, confira e finalize de novo.';
  const RECUSA: EstadoDoCheckout = {
    recado: { tom: 'erro', texto: RECALCULADO },
    campo: null,
    recotarFrete: true,
  };
  const SO_SEDEX: RespostaDoFrete = { ok: true, subtotalCentavos: 12000, opcoes: [SEDEX] };
  const recado = () => document.getElementById('erro-entrega');
  const finalizar = async (form: HTMLFormElement) => {
    await act(async () => {
      fireEvent.submit(form);
    });
  };

  it('a caixa esquece o servico recusado, volta ao esqueleto e cota o CEP atual', async () => {
    vi.mocked(cotarFrete).mockResolvedValueOnce(SO_SEDEX);
    vi.mocked(finalizarCompra).mockResolvedValueOnce(RECUSA);
    const { container } = monta();
    await digitaCep('01310100');
    expect((screen.getByRole('radio', { name: /SEDEX/ }) as HTMLInputElement).checked).toBe(true);

    const voo = emVoo();
    vi.mocked(cotarFrete).mockReturnValueOnce(voo.promessa);
    await finalizar(container.querySelector('form') as HTMLFormElement);

    expect(cotarFrete).toHaveBeenCalledTimes(2);
    expect(vi.mocked(cotarFrete).mock.calls[1][0]).toEqual(vi.mocked(cotarFrete).mock.calls[0][0]);
    expect(container.querySelectorAll('.frete-esqueleto')).toHaveLength(2);
    expect(container.querySelector('.frete')?.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(botao().disabled).toBe(true);
    expect(botao().textContent).toContain('Aguardando o frete');
    // O recado fica no lugar dele enquanto a caixa cota.
    expect(recado()?.textContent).toBe(RECALCULADO);

    await act(async () => voo.solta({ ok: true, subtotalCentavos: 12000, opcoes: [PAC] }));

    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect((screen.getByRole('radio', { name: /PAC/ }) as HTMLInputElement).checked).toBe(true);
    expect(botao().disabled).toBe(false);
    expect(reais(botao().textContent ?? '')).toContain('Finalizar — R$ 143,50');
  });

  it('duas recusas seguidas cotam duas vezes', async () => {
    vi.mocked(finalizarCompra)
      .mockResolvedValueOnce(RECUSA)
      .mockResolvedValueOnce({ ...RECUSA });
    const { container } = monta();
    const form = container.querySelector('form') as HTMLFormElement;
    await digitaCep('01310100');

    await finalizar(form);
    expect(cotarFrete).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole('radio')).toHaveLength(2);

    await finalizar(form);
    expect(cotarFrete).toHaveBeenCalledTimes(3);
  });

  it('erro que nao e do frete deixa a caixa como esta', async () => {
    const { container } = monta();
    await digitaCep('01310100');
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /SEDEX/ }));
    });

    await finalizar(container.querySelector('form') as HTMLFormElement);
    await screen.findByText('Confira o CEP.');

    expect(cotarFrete).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('.frete-esqueleto')).toHaveLength(0);
    expect((screen.getByRole('radio', { name: /SEDEX/ }) as HTMLInputElement).checked).toBe(true);
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

describe('CEP lembrado da ficha (#205)', () => {
  it('o checkout comeca com o CEP da ficha, e ja cota e busca o endereco', async () => {
    lembraCep('04538133');
    await act(async () => {
      monta();
    });

    expect(campo('CEP').value).toBe('04538-133');
    expect(cotarFrete).toHaveBeenCalledWith({
      slug: 'camiseta-cbac',
      tamanho: 'M',
      quantidade: 1,
      cep: '04538133',
    });
    expect(buscarEndereco).toHaveBeenCalledWith('04538133');
  });

  it('sem CEP lembrado, o campo comeca vazio', async () => {
    await act(async () => {
      monta();
    });
    expect(campo('CEP').value).toBe('');
    expect(cotarFrete).not.toHaveBeenCalled();
  });

  it('depois de chegar, o campo e da pessoa: apagar nao traz o lembrado de volta', async () => {
    lembraCep('04538133');
    await act(async () => {
      monta();
    });
    await digitaCep('');
    expect(campo('CEP').value).toBe('');
  });
});
