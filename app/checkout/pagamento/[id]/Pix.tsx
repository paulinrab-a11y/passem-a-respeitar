'use client';

import { useState } from 'react';
import { formataDiaHora } from '@/lib/datas';

/**
 * Pix gerado (Issue #110).
 *
 * O QR e o copia-e-cola vem do provedor, nunca montados aqui. Gerar payload
 * Pix na mao significaria escrever a chave, o valor e o CRC por conta propria
 * — e um erro de um caractere vira dinheiro indo para lugar nenhum.
 */

export type DadosDoPix = {
  copiaECola: string;
  qrBase64: string | null;
  expiraEm: string | null;
};

export default function Pix({ dados, valor }: { dados: DadosDoPix; valor: string }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(dados.copiaECola);
      setCopiado(true);
      // Volta ao normal sozinho: um "Copiado" eterno vira enfeite e a pessoa
      // deixa de saber se o clique de agora funcionou.
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // Clipboard negado (permissao, http). O <input> ao lado continua
      // selecionavel na mao, entao nao ha beco sem saida.
      setCopiado(false);
    }
  }

  return (
    <div className="pix">
      <p className="pix-valor">{valor}</p>

      {dados.qrBase64 ? (
        // biome-ignore lint/performance/noImgElement: o QR vem em base64 do provedor, sem URL para o otimizador do Next buscar
        <img
          className="pix-qr"
          src={`data:image/png;base64,${dados.qrBase64}`}
          alt="QR Code do Pix. Abaixo há o código para copiar."
          width={240}
          height={240}
        />
      ) : null}

      <label className="pix-codigo">
        <span>Pix copia e cola</span>
        {/* readOnly e nao disabled: disabled impede selecionar o texto, que e
            justamente o caminho alternativo de quem nao pode usar a area de
            transferencia. */}
        <input readOnly value={dados.copiaECola} onFocus={(e) => e.currentTarget.select()} />
      </label>

      <button type="button" className="btn cheio" onClick={copiar}>
        {copiado ? 'Copiado' : 'Copiar código Pix'}
      </button>

      {/* aria-live: quem usa leitor de tela precisa saber que copiou sem
          voltar o foco ao botao para reler o rotulo. */}
      <p className="sr" role="status" aria-live="polite">
        {copiado ? 'Código Pix copiado.' : ''}
      </p>

      {/* O vencimento sai pelo helper de datas (#248): fuso fixo, entao o
          servidor e o navegador escrevem o mesmo texto e a hidratacao bate. */}
      <p className="pix-espera">
        <span className="pedido-status atencao">Aguardando pagamento</span>
        {dados.expiraEm ? ` · vence em ${formataDiaHora(dados.expiraEm)}` : ''}
      </p>

      <p className="detalhe-nota">
        Pague pelo aplicativo do seu banco. A confirmação chega sozinha, e o pedido muda de status
        aqui — pode fechar esta página.
      </p>
    </div>
  );
}
