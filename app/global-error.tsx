'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * Ultimo recurso do App Router (Issue #8): quando o proprio layout raiz
 * quebra, e isto que a pessoa ve. Por isso tem <html> e <body> proprios —
 * o layout de sempre ja nao existe neste ponto.
 *
 * O erro vai para o Sentry no efeito, nao na renderizacao: renderizar pode
 * acontecer mais de uma vez, e cada vez seria um evento a mais.
 *
 * Estilo inline de proposito: o globals.css pode ser justamente o que
 * falhou. Preto, prata, Anton pelo sistema se houver — o minimo da
 * identidade sem depender de nada.
 */
export default function ErroGlobal({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#000',
          color: '#c9c9c9',
          fontFamily: 'Anton, Impact, sans-serif',
          textTransform: 'uppercase',
          letterSpacing: '.06em',
          textAlign: 'center',
          padding: '24px',
        }}
      >
        <div>
          <h1 style={{ color: '#fff', fontSize: '2rem', margin: '0 0 12px' }}>Deu ruim por aqui</h1>
          <p style={{ margin: '0 0 24px', fontSize: '.9rem' }}>
            Já ficamos sabendo. Tenta de novo — se insistir, volta daqui a pouco.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: '#c9c9c9',
              color: '#000',
              border: 0,
              padding: '14px 22px',
              font: 'inherit',
              letterSpacing: '.2em',
              cursor: 'pointer',
            }}
          >
            Tentar de novo
          </button>
        </div>
      </body>
    </html>
  );
}
