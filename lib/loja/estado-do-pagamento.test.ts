import { describe, expect, it } from 'vitest';
import { type EstadoInterno, montaEstado, podeAvancar } from './estado-do-pagamento';

describe('montaEstado', () => {
  // O vocabulario da Orders API, que e o que a integracao usa hoje.
  it.each([
    ['processed', 'accredited', 'aprovado'],
    ['action_required', 'waiting_transfer', 'pendente'],
    ['failed', 'cc_rejected_insufficient_amount', 'recusado'],
    ['expired', null, 'cancelado'],
    ['refunded', null, 'estornado'],
  ])('Orders: %s -> %s', (status, detail, esperado) => {
    expect(montaEstado(status, detail).estado).toBe(esperado);
  });

  // A Payments API esta marcada como legado, mas integracao antiga e webhook
  // de outra epoca ainda podem falar assim.
  it.each([
    ['approved', 'aprovado'],
    ['pending', 'pendente'],
    ['in_process', 'pendente'],
    ['rejected', 'recusado'],
    ['cancelled', 'cancelado'],
    ['charged_back', 'estornado'],
  ])('Payments: %s -> %s', (status, esperado) => {
    expect(montaEstado(status).estado).toBe(esperado);
  });

  it('guarda o status cru, sem traduzir', () => {
    const r = montaEstado('action_required', 'waiting_transfer');

    expect(r.status).toBe('action_required');
    expect(r.statusDetail).toBe('waiting_transfer');
  });

  it('aceita maiuscula e espaco em volta', () => {
    expect(montaEstado('  PROCESSED  ').estado).toBe('aprovado');
  });

  // Os dois erros possiveis nao custam igual: "aprovado" sem ter sido manda
  // mercadoria de graca.
  it.each([
    ['status novo', 'status_que_nao_existe'],
    ['vazio', ''],
    ['nulo', null],
    ['ausente', undefined],
  ])('%s vira pendente, nunca aprovado', (_caso, status) => {
    expect(montaEstado(status).estado).toBe('pendente');
  });

  it('nao se confunde com nome herdado de Object', () => {
    expect(montaEstado('constructor').estado).toBe('pendente');
    expect(montaEstado('toString').estado).toBe('pendente');
  });
});

describe('podeAvancar', () => {
  // A razao de existir: notificacao chega fora de ordem, e uma antiga dizendo
  // "pendente" nao pode apagar um "aprovado" que ja chegou.
  it('pendente nao derruba aprovado', () => {
    expect(podeAvancar('aprovado', 'pendente')).toBe(false);
  });

  it('recusado nao derruba aprovado', () => {
    expect(podeAvancar('aprovado', 'recusado')).toBe(false);
  });

  it('estorno e o unico caminho depois de aprovado', () => {
    expect(podeAvancar('aprovado', 'estornado')).toBe(true);
    expect(podeAvancar('aprovado', 'cancelado')).toBe(false);
  });

  it.each<[EstadoInterno, EstadoInterno]>([
    ['cancelado', 'aprovado'],
    ['cancelado', 'pendente'],
    ['estornado', 'aprovado'],
    ['estornado', 'pendente'],
  ])('%s nao volta para %s', (atual, novo) => {
    expect(podeAvancar(atual, novo)).toBe(false);
  });

  it.each<[EstadoInterno, EstadoInterno]>([
    ['criado', 'pendente'],
    ['criado', 'aprovado'],
    ['criado', 'recusado'],
    ['pendente', 'aprovado'],
    ['pendente', 'recusado'],
    ['pendente', 'cancelado'],
    // Cartao recusado e a pessoa tenta de novo, e da certo.
    ['recusado', 'aprovado'],
  ])('%s pode virar %s', (atual, novo) => {
    expect(podeAvancar(atual, novo)).toBe(true);
  });

  // Evento repetido chega o tempo todo. Nao e avanco, e ruido.
  it.each<EstadoInterno>(['criado', 'pendente', 'aprovado', 'recusado', 'cancelado', 'estornado'])(
    'o mesmo estado (%s) nao e avanco',
    (estado) => {
      expect(podeAvancar(estado, estado)).toBe(false);
    }
  );
});
