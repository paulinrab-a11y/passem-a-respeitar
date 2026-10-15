'use client';

import { useEffect, useRef, useState } from 'react';
import Rotulo from '@/app/_ui/Rotulo';

/**
 * Botao de copiar um texto (nasceu como o endereco do painel, #242; virou
 * generico com o codigo de rastreio, #378).
 *
 * Tres estados, e o botao nao muda de largura em nenhum (`Rotulo`). Copiar e
 * assincrono e quase instantaneo, mas "quase" e o que faz a pessoa clicar de
 * novo: enquanto a escrita nao volta, o botao fica desabilitado e com a barra
 * de carregando (#50). "Copiado" volta ao normal sozinho, senao vira enfeite
 * e o clique seguinte nao diz se funcionou.
 *
 * Quando a area de transferencia e negada (permissao, http), a mensagem
 * aponta para o texto, que continua selecionavel na tela: nao ha beco.
 */

const VOLTA_MS = 2500;

type Estado = 'parado' | 'copiando' | 'copiado' | 'falhou';

type Props = {
  texto: string;
  /** O que o botao diz parado. */
  rotulo: string;
  /** Nome acessivel, quando ha varios botoes destes na tela. */
  nome?: string;
  /** Lido por quem ouve a pagina quando copia. */
  copiado: string;
  /** Visivel para todo mundo quando nao copia: diz onde esta o texto. */
  falhou: string;
};

export default function Copiar({ texto, rotulo, nome, copiado, falhou }: Props) {
  const [estado, setEstado] = useState<Estado>('parado');
  const volta = useRef<ReturnType<typeof setTimeout> | null>(null);

  // O prazo de voltar morre com o componente: a tela pode ser redesenhada
  // antes dos 2,5 s.
  useEffect(() => () => clearTimeout(volta.current ?? undefined), []);

  async function copiar() {
    if (estado === 'copiando') return;
    setEstado('copiando');

    try {
      await navigator.clipboard.writeText(texto);
      setEstado('copiado');
      clearTimeout(volta.current ?? undefined);
      volta.current = setTimeout(() => setEstado('parado'), VOLTA_MS);
    } catch {
      setEstado('falhou');
    }
  }

  const copiando = estado === 'copiando';

  return (
    <>
      <button
        type="button"
        className={`btn${copiando ? ' carregando' : ''}`}
        disabled={copiando}
        onClick={copiar}
        aria-label={nome}
      >
        <Rotulo parado={rotulo} agindo="Copiado" ativo={estado === 'copiado'} />
      </button>

      {/* Quem ouve a pagina precisa saber que copiou sem voltar o foco ao
          botao para reler o rotulo. A falha e visivel para todo mundo. */}
      <p
        className={estado === 'falhou' ? 'admin-copiar-falhou' : 'sr'}
        role="status"
        aria-live="polite"
      >
        {estado === 'copiado' ? copiado : ''}
        {estado === 'falhou' ? falhou : ''}
      </p>
    </>
  );
}
