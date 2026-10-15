'use client';

import Image from 'next/image';
import { useState } from 'react';

/**
 * Galeria da merch (Issue #47).
 *
 * Antes o script legado montava as fotos por `innerHTML`, com o JPEG
 * original: 1800 px de largura para uma moldura que no telefone tem 350.
 * Com `next/image` o navegador escolhe a largura pela moldura e recebe
 * AVIF ou WebP.
 *
 * Todas preguicosas: a galeria fica muitas telas abaixo da dobra, e nenhuma
 * foto dela disputa banda com o hero. `priority` e so do logo.
 *
 * A moldura e a do esqueleto da #46: ela ja ocupa o espaco final, brilha
 * enquanto a foto nao chega, e a foto entra por cima com fade.
 */

/**
 * Cada foto com o seu alt: o mesmo nome repetido sete vezes nao deixa quem
 * usa leitor de tela saber em qual foto esta nem quantas faltam.
 */
export function altDaFoto(alt: string, i: number, total: number) {
  const posicao = `foto ${i + 1} de ${total}`;
  return alt ? `${alt}, ${posicao}` : `F${posicao.slice(1)}`;
}

/** A primeira ocupa a largura da galeria; as duas seguintes, metade; o resto, um terco. */
function tamanhos(i: number) {
  if (i === 0) return '(max-width: 767px) 100vw, 50vw';
  if (i < 3) return '(max-width: 767px) 50vw, 25vw';
  return '(max-width: 767px) 50vw, 17vw';
}

export default function Galeria({ fotos, alt }: { fotos: string[]; alt: string }) {
  const [prontas, setProntas] = useState<ReadonlySet<string>>(new Set());

  // Erro tambem encerra o brilho: foto que nao veio nao pode deixar a moldura
  // carregando para sempre.
  const pronta = (foto: string) =>
    setProntas((antes) => (antes.has(foto) ? antes : new Set(antes).add(foto)));

  return (
    <>
      {fotos.map((foto, i) => (
        <figure key={foto} className={prontas.has(foto) ? 'ok' : undefined}>
          <Image
            src={foto}
            alt={altDaFoto(alt, i, fotos.length)}
            // Proporcao 3:2, a mesma da moldura. O valor so reserva espaco e
            // escolhe o maior arquivo do srcset; quem define o tamanho na
            // tela e o CSS.
            width={i === 0 ? 1800 : 1000}
            height={i === 0 ? 1200 : 667}
            sizes={tamanhos(i)}
            loading="lazy"
            decoding="async"
            onLoad={() => pronta(foto)}
            onError={() => pronta(foto)}
          />
        </figure>
      ))}
    </>
  );
}
