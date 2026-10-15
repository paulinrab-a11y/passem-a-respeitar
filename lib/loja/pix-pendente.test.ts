import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Qual Pix a tela de pagamento mostra de volta (#369). So a ultima tentativa,
 * so Pix, so pendente, so com ordem no provedor, so no prazo do pedido — e o
 * resto e o provedor quem diz.
 */
type Linha = { metodo: string | null; estado: string; provedor_pagamento_id: string | null };

const consulta = {
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  maybeSingle: vi.fn<() => Promise<{ data: Linha | null; error: unknown }>>(),
};
const from = vi.fn(() => consulta);
const pixDaOrdem = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({ clienteAdmin: () => ({ from }) }));
vi.mock('./orders-api', () => ({
  pixDaOrdem: (id: string, agora: number) => pixDaOrdem(id, agora),
}));

const { pixPendente } = await import('./pix-pendente');

const PEDIDO = '44444444-4444-4444-8444-444444444444';
const AGORA = Date.parse('2026-10-15T12:00:00Z');
const CRIADO = '2026-10-15T10:00:00Z';
const PIX = { copiaECola: '0002-copia-e-cola', qrBase64: null, expiraEm: null };

const ultima = (linha: Linha | null, error: unknown = null) =>
  consulta.maybeSingle.mockResolvedValue({ data: linha, error });

beforeEach(() => {
  vi.clearAllMocks();
  consulta.select.mockReturnValue(consulta);
  consulta.eq.mockReturnValue(consulta);
  consulta.order.mockReturnValue(consulta);
  consulta.limit.mockReturnValue(consulta);
  ultima({ metodo: 'pix', estado: 'pendente', provedor_pagamento_id: 'ORD-PIX' });
  pixDaOrdem.mockResolvedValue(PIX);
});

describe('pixPendente', () => {
  it('ultima tentativa Pix pendente: pergunta ao provedor por aquela ordem', async () => {
    expect(await pixPendente(PEDIDO, CRIADO, AGORA)).toEqual(PIX);

    expect(from).toHaveBeenCalledWith('pagamentos');
    expect(consulta.eq).toHaveBeenCalledWith('order_id', PEDIDO);
    expect(consulta.order).toHaveBeenCalledWith('tentativa', { ascending: false });
    expect(consulta.limit).toHaveBeenCalledWith(1);
    expect(pixDaOrdem).toHaveBeenCalledWith('ORD-PIX', AGORA);
  });

  it('nao le a chave de idempotencia', async () => {
    await pixPendente(PEDIDO, CRIADO, AGORA);

    expect(String(consulta.select.mock.calls[0][0])).not.toContain('idempotency_key');
  });

  it.each([
    ['cartao', { metodo: 'credit_card', estado: 'pendente', provedor_pagamento_id: 'ORD-1' }],
    ['Pix recusado', { metodo: 'pix', estado: 'recusado', provedor_pagamento_id: 'ORD-1' }],
    ['Pix cancelado', { metodo: 'pix', estado: 'cancelado', provedor_pagamento_id: 'ORD-1' }],
    ['Pix sem resposta', { metodo: 'pix', estado: 'criado', provedor_pagamento_id: null }],
    ['Pix sem ordem', { metodo: 'pix', estado: 'pendente', provedor_pagamento_id: null }],
  ])('ultima tentativa %s: nem pergunta ao provedor', async (_nome, linha) => {
    ultima(linha);

    expect(await pixPendente(PEDIDO, CRIADO, AGORA)).toBeNull();
    expect(pixDaOrdem).not.toHaveBeenCalled();
  });

  it('sem tentativa nenhuma, ou banco fora: nulo', async () => {
    ultima(null);
    expect(await pixPendente(PEDIDO, CRIADO, AGORA)).toBeNull();

    ultima(null, { code: '08006' });
    expect(await pixPendente(PEDIDO, CRIADO, AGORA)).toBeNull();
    expect(pixDaOrdem).not.toHaveBeenCalled();
  });

  it('pedido fora do prazo nao mostra Pix nenhum, nem vai ao banco', async () => {
    expect(await pixPendente(PEDIDO, '2026-10-13T11:00:00Z', AGORA)).toBeNull();

    expect(from).not.toHaveBeenCalled();
    expect(pixDaOrdem).not.toHaveBeenCalled();
  });

  it('o provedor diz que nao esta mais pendente: nulo', async () => {
    pixDaOrdem.mockResolvedValue(null);

    expect(await pixPendente(PEDIDO, CRIADO, AGORA)).toBeNull();
  });
});
