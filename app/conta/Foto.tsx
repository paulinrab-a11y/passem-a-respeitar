'use client';

import { useRef, useState } from 'react';

type Estado =
  | { fase: 'parado' }
  | { fase: 'enviando'; porcento: number }
  | { fase: 'erro'; texto: string };

export default function Foto({ url, iniciais }: { url: string | null; iniciais: string }) {
  const campo = useRef<HTMLInputElement>(null);
  const [mostrada, setMostrada] = useState(url);
  const [estado, setEstado] = useState<Estado>({ fase: 'parado' });

  /**
   * XHR e nao `fetch`, pelo unico motivo que ainda justifica XHR em 2026:
   * `upload.onprogress`. O `fetch` nao reporta progresso de ENVIO, e um
   * arquivo de 2 MB em rede de celular ficaria parado sem sinal nenhum.
   */
  function envia(arquivo: File) {
    const corpo = new FormData();
    corpo.append('foto', arquivo);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/conta/foto');

    xhr.upload.addEventListener('progress', (e) => {
      if (!e.lengthComputable) return;
      setEstado({ fase: 'enviando', porcento: Math.round((e.loaded / e.total) * 100) });
    });

    xhr.addEventListener('load', () => {
      let resposta: { ok?: boolean; url?: string; erro?: string } = {};
      try {
        resposta = JSON.parse(xhr.responseText);
      } catch {
        // Resposta que nem e JSON: erro de infraestrutura, nao da rota.
      }

      if (xhr.status === 200 && resposta.url) {
        setMostrada(resposta.url);
        setEstado({ fase: 'parado' });
        return;
      }

      setEstado({ fase: 'erro', texto: resposta.erro ?? 'Não consegui enviar a imagem.' });
    });

    xhr.addEventListener('error', () => {
      setEstado({ fase: 'erro', texto: 'A conexão caiu no meio do envio.' });
    });

    setEstado({ fase: 'enviando', porcento: 0 });
    xhr.send(corpo);
  }

  const enviando = estado.fase === 'enviando';

  return (
    <div className="conta-foto-bloco">
      <div className="conta-foto">
        {mostrada ? (
          // Sem next/image: a URL e assinada e expira, entao passar pelo
          // otimizador do Next so criaria um cache de link morto.
          // biome-ignore lint/performance/noImgElement: URL assinada, ver comentario
          <img src={mostrada} alt="" width={96} height={96} />
        ) : (
          <span className="conta-iniciais" aria-hidden="true">
            {iniciais}
          </span>
        )}

        {enviando ? (
          <div
            className="conta-progresso"
            role="progressbar"
            aria-label="Enviando foto"
            aria-valuenow={estado.porcento}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            {/* scaleX em vez de width: largura e layout, transform e GPU. */}
            <i style={{ transform: `scaleX(${estado.porcento / 100})` }} />
          </div>
        ) : null}
      </div>

      <div className="conta-foto-acoes">
        <button
          type="button"
          className="auth-link"
          onClick={() => campo.current?.click()}
          disabled={enviando}
        >
          {enviando ? `Enviando… ${estado.porcento}%` : mostrada ? 'Trocar foto' : 'Escolher foto'}
        </button>

        <input
          ref={campo}
          type="file"
          className="sr"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            // Limpa o valor para escolher o MESMO arquivo de novo disparar
            // change — sem isso, tentar de novo depois de um erro nao faz nada.
            e.target.value = '';
            if (arquivo) envia(arquivo);
          }}
        />

        {estado.fase === 'erro' ? (
          <p className="conta-recado erro" role="alert">
            {estado.texto}
          </p>
        ) : null}
      </div>
    </div>
  );
}
