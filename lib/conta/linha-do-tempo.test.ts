import { describe, expect, it } from 'vitest';
import { type EventoDoBanco, montaLinhaDoTempo } from './linha-do-tempo';

const ROTULOS = ['Pedido recebido', 'Pagamento confirmado', 'Em separação', 'Enviado', 'Entregue'];

function evento(para: string, criado_em: string): EventoDoBanco {
  return { para, criado_em };
}

/** Pedido que andou ate `ate`, um dia por etapa a partir de 20/09. */
function trilhaAte(ate: number): EventoDoBanco[] {
  const status = ['aguardando_pagamento', 'pago', 'em_producao', 'enviado', 'entregue'];
  return status
    .slice(0, ate + 1)
    .map((s, i) => evento(s, `2026-09-${String(20 + i).padStart(2, '0')}T12:00:00Z`));
}

const estados = (l: ReturnType<typeof montaLinhaDoTempo>) => l.etapas.map((e) => e.estado);

describe('montaLinhaDoTempo', () => {
  it('desenha as cinco etapas da #42, na ordem', () => {
    const linha = montaLinhaDoTempo('aguardando_pagamento', trilhaAte(0));
    expect(linha.etapas.map((e) => e.rotulo)).toEqual(ROTULOS);
  });

  it('pedido recem-criado: so a primeira aconteceu', () => {
    const linha = montaLinhaDoTempo('aguardando_pagamento', trilhaAte(0));

    expect(estados(linha)).toEqual(['atual', 'futura', 'futura', 'futura', 'futura']);
    expect(linha.etapas[0].em).toBe('2026-09-20T12:00:00Z');
    expect(linha.etapas[1].em).toBeNull();
    expect(linha.ramo).toBeNull();
  });

  it('pedido no meio do caminho', () => {
    const linha = montaLinhaDoTempo('enviado', trilhaAte(3));
    expect(estados(linha)).toEqual(['feita', 'feita', 'feita', 'atual', 'futura']);
  });

  it('pedido entregue: a ultima etapa e a atual', () => {
    const linha = montaLinhaDoTempo('entregue', trilhaAte(4));
    expect(estados(linha)).toEqual(['feita', 'feita', 'feita', 'feita', 'atual']);
  });

  describe('cancelado e reembolsado sao ramo, nao etapa', () => {
    const cancelado = [...trilhaAte(1), evento('cancelado', '2026-09-24T09:00:00Z')];

    it('o ramo sai fora da fila, com a data dele', () => {
      const linha = montaLinhaDoTempo('cancelado', cancelado);

      expect(linha.ramo).toEqual({ rotulo: 'Cancelado', em: '2026-09-24T09:00:00Z' });
      expect(linha.etapas.map((e) => e.rotulo)).toEqual(ROTULOS);
    });

    // Mostrar "Entregue" como pendente num pedido cancelado e prometer uma
    // entrega que nao vem.
    it('o que nao aconteceu deixa de ser pendente', () => {
      expect(estados(montaLinhaDoTempo('cancelado', cancelado))).toEqual([
        'feita',
        'feita',
        'nao-aconteceu',
        'nao-aconteceu',
        'nao-aconteceu',
      ]);
    });

    it('nenhuma etapa vira `atual`: quem e o agora e o ramo', () => {
      expect(estados(montaLinhaDoTempo('cancelado', cancelado))).not.toContain('atual');
    });

    it('reembolsado tambem e ramo', () => {
      const linha = montaLinhaDoTempo('reembolsado', [
        ...trilhaAte(4),
        evento('reembolsado', '2026-09-30T10:00:00Z'),
      ]);
      expect(linha.ramo).toEqual({ rotulo: 'Reembolsado', em: '2026-09-30T10:00:00Z' });
    });

    // Um cancelamento desfeito nao e mais a historia do pedido: a fila voltou
    // a andar, e quem manda e o status de agora.
    it('cancelamento desfeito deixa de ser ramo', () => {
      const linha = montaLinhaDoTempo('em_producao', [
        ...trilhaAte(1),
        evento('cancelado', '2026-09-24T09:00:00Z'),
        evento('pago', '2026-09-25T09:00:00Z'),
        evento('em_producao', '2026-09-26T09:00:00Z'),
      ]);

      expect(linha.ramo).toBeNull();
      expect(estados(linha)).toEqual(['feita', 'feita', 'atual', 'futura', 'futura']);
    });
  });

  describe('trilha torta', () => {
    it('etapa repetida guarda a PRIMEIRA vez, que mantem a fila em ordem', () => {
      const linha = montaLinhaDoTempo('pago', [
        evento('aguardando_pagamento', '2026-09-20T12:00:00Z'),
        evento('pago', '2026-09-21T12:00:00Z'),
        evento('aguardando_pagamento', '2026-09-22T12:00:00Z'),
        evento('pago', '2026-09-23T12:00:00Z'),
      ]);

      expect(linha.etapas[0].em).toBe('2026-09-20T12:00:00Z');
      expect(linha.etapas[1].em).toBe('2026-09-21T12:00:00Z');
    });

    // O ramo pergunta "quando foi cancelado?", e a resposta e a ultima vez —
    // e essa que ainda vale.
    it('o ramo guarda a ULTIMA vez', () => {
      const linha = montaLinhaDoTempo('cancelado', [
        evento('aguardando_pagamento', '2026-09-20T12:00:00Z'),
        evento('cancelado', '2026-09-21T12:00:00Z'),
        evento('pago', '2026-09-22T12:00:00Z'),
        evento('cancelado', '2026-09-23T12:00:00Z'),
      ]);

      expect(linha.ramo?.em).toBe('2026-09-23T12:00:00Z');
    });

    it('eventos fora de ordem sao ordenados antes de virar etapa', () => {
      const linha = montaLinhaDoTempo('pago', [
        evento('pago', '2026-09-21T12:00:00Z'),
        evento('aguardando_pagamento', '2026-09-20T12:00:00Z'),
      ]);

      expect(linha.etapas[0].em).toBe('2026-09-20T12:00:00Z');
      expect(estados(linha)).toEqual(['feita', 'atual', 'futura', 'futura', 'futura']);
    });

    // Duas linhas com o mesmo carimbo nao tem desempate possivel — e nao
    // precisam ter: a etapa so guarda a data, e a data das duas e a mesma.
    it('carimbos identicos nao mudam nada', () => {
      const mesmo = '2026-09-20T12:00:00.000Z';
      const linha = montaLinhaDoTempo('pago', [
        evento('aguardando_pagamento', mesmo),
        evento('pago', mesmo),
      ]);

      expect(linha.etapas[0].em).toBe(mesmo);
      expect(linha.etapas[1].em).toBe(mesmo);
      expect(estados(linha)).toEqual(['feita', 'atual', 'futura', 'futura', 'futura']);
    });

    it('carimbos a milissegundos de distancia mantem a ordem', () => {
      const linha = montaLinhaDoTempo('pago', [
        evento('pago', '2026-09-20T12:00:00.002Z'),
        evento('aguardando_pagamento', '2026-09-20T12:00:00.001Z'),
      ]);

      expect(linha.etapas[0].em).toBe('2026-09-20T12:00:00.001Z');
      expect(linha.etapas[1].em).toBe('2026-09-20T12:00:00.002Z');
    });

    // Status que o enum nao conhece nao vira etapa e nao vira ramo. O pedido
    // nao pode sumir da tela por causa de uma migration que os tipos ainda nao
    // acompanharam.
    it('status desconhecido nao quebra a fila', () => {
      const linha = montaLinhaDoTempo('extraviado', [
        ...trilhaAte(3),
        evento('extraviado', '2026-09-25T12:00:00Z'),
      ]);

      expect(linha.ramo).toBeNull();
      expect(linha.etapas).toHaveLength(5);
      expect(estados(linha)).toEqual(['feita', 'feita', 'feita', 'atual', 'futura']);
    });

    it('nao se confunde com nome herdado de Object', () => {
      const linha = montaLinhaDoTempo('constructor', [
        evento('constructor', '2026-09-20T12:00:00Z'),
      ]);

      expect(linha.ramo).toBeNull();
      expect(estados(linha)).toEqual(['futura', 'futura', 'futura', 'futura', 'futura']);
    });
  });

  describe('pedido legado, sem trilha', () => {
    it('marca semRegistro e nao inventa etapa nenhuma', () => {
      const linha = montaLinhaDoTempo('enviado', []);

      expect(linha.semRegistro).toBe(true);
      expect(linha.etapas.every((e) => e.em === null)).toBe(true);
      expect(estados(linha)).toEqual(['futura', 'futura', 'futura', 'futura', 'futura']);
    });

    it('ainda mostra o ramo se o status de agora for ramo, mas sem data', () => {
      const linha = montaLinhaDoTempo('cancelado', []);

      expect(linha.ramo).toEqual({ rotulo: 'Cancelado', em: null });
      expect(linha.semRegistro).toBe(true);
    });

    it('semRegistro e falso assim que existe um evento', () => {
      expect(montaLinhaDoTempo('aguardando_pagamento', trilhaAte(0)).semRegistro).toBe(false);
    });
  });

  it('nao muda o array que recebeu', () => {
    const eventos = [
      evento('pago', '2026-09-21T12:00:00Z'),
      evento('aguardando_pagamento', '2026-09-20T12:00:00Z'),
    ];
    const copia = [...eventos];

    montaLinhaDoTempo('pago', eventos);

    expect(eventos).toEqual(copia);
  });
});
