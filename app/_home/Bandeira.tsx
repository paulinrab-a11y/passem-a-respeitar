import type { CSSProperties } from 'react';
import geometria from '@/lib/marca/bandeira-geometria.json';
import { ondas } from './onda-da-bandeira';

// A bandeira da Occupation acima do pre-save. As duas camadas saem de
// lib/marca/gera-bandeira.mjs: a figura parada (pessoa, mastro, OCCUPATION) e
// o pano, desvirado, que aqui volta para o mastro girado pelo mesmo angulo e
// fatiado em tiras. O movimento e o porque dele estao em ./onda-da-bandeira.ts e no
// globals.css; sem JavaScript as tiras ficam paradas, e a bandeira inteira
// aparece do mesmo jeito.
//
// Largura e altura vem da imagem: a caixa nasce do tamanho final (CLS 0).

const FIGURA = '/bandeira/occupation-figura.webp';
const PANO = '/bandeira/occupation-pano.webp';

const { figura, pano } = geometria;
const TIRAS = ondas(pano.altura / pano.largura);

const caixaDoPano = {
  left: `${pano.esquerda}%`,
  top: `${pano.topo}%`,
  width: `${pano.larguraPct}%`,
  height: `${pano.alturaPct}%`,
  transform: `rotate(${pano.angulo}deg)`,
  '--n': TIRAS.length,
} as CSSProperties;

export default function Bandeira() {
  return (
    <div className="bandeira" style={{ aspectRatio: `${figura.largura} / ${figura.altura}` }}>
      {/* biome-ignore lint/performance/noImgElement: arquivo ja otimizado por lib/marca/gera-bandeira.mjs; o otimizador do Next nao reduziria nada e trocaria o WebP com alpha sem perda por outro. */}
      <img
        className="figura"
        src={FIGURA}
        alt="Bandeira da Occupation: uma pessoa ergue o mastro com a bandeira e o emblema, e a palavra OCCUPATION ao longo do mastro."
        width={figura.largura}
        height={figura.altura}
        loading="lazy"
        decoding="async"
      />
      <div className="pano" style={caixaDoPano} aria-hidden="true">
        {TIRAS.map((t, i) => (
          <div
            // A ordem das tiras e fixa: o indice e a identidade delas.
            // biome-ignore lint/suspicious/noArrayIndexKey: lista fixa, nunca reordena.
            key={i}
            className="tira"
            style={
              {
                '--i': i,
                '--a': t.a,
                '--k': t.k,
                '--d': `${t.d}s`,
                '--d2': `${t.d2}s`,
              } as CSSProperties
            }
          >
            <div className="dobra">
              {/* biome-ignore lint/performance/noImgElement: a mesma imagem do pano em cada tira; o navegador baixa uma vez. */}
              <img
                src={PANO}
                alt=""
                width={pano.largura}
                height={pano.altura}
                loading="lazy"
                decoding="async"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
