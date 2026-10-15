'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Mensagem from '@/app/_ui/Mensagem';
import {
  BOTAO_DO_TIPO,
  DICA_DA_MENSAGEM,
  MENSAGEM_MAX,
  NOME_DO_TIPO,
  type TipoPosVenda,
} from '@/lib/conta/pos-venda';
import { formataDataHora } from '@/lib/datas';
import { RESPOSTA_DIAS_UTEIS } from '@/lib/loja/termos';
import { pedirPosVenda } from './acoes';
import { posVendaInicial } from './estado';

/** O que acontece depois, por tipo. Nada que os termos nao digam. */
const O_QUE_ACONTECE: Record<TipoPosVenda, string> = {
  cancelamento:
    'A loja confere que a camiseta ainda não saiu e devolve tudo o que você pagou, camiseta e frete, pelo mesmo meio de pagamento.',
  arrependimento:
    'A loja responde com as instruções para devolver a camiseta. Você recebe de volta tudo o que pagou, inclusive o frete.',
  troca: 'A loja responde com as instruções da troca.',
  defeito: 'A loja responde pedindo uma foto e diz como resolve.',
};

/**
 * Os botoes de cancelar, desistir, trocar e avisar de defeito (Issue #379).
 *
 * Dois passos, de proposito: o botao abre a confirmacao, e so "Confirmar"
 * envia. Um clique sem querer num "Pedir cancelamento" viraria trabalho para
 * o dono e susto para quem comprou. A confirmacao diz o que acontece depois
 * e aceita uma mensagem curta, opcional.
 *
 * Enviado, a tela mostra NA HORA o protocolo e a hora do registro: e a
 * confirmacao de recebimento que o Decreto 7.962/2013 (art. 5º, § 4º) pede, e
 * a unica, porque o site ainda nao manda e-mail (#55). O foco vai para ela,
 * para quem usa leitor de tela ouvir o protocolo sem procurar.
 *
 * Motion: a confirmacao e o recibo entram com fade e um deslocamento curto
 * (so `transform` e `opacity`, 200 ms); com movimento reduzido, so o fade.
 */
export default function PedirPosVenda({
  pedido,
  tipos,
}: {
  pedido: string;
  /** Os que cabem agora e ainda nao tem solicitacao aberta. */
  tipos: readonly TipoPosVenda[];
}) {
  const [estado, acao, pendente] = useActionState(pedirPosVenda, posVendaInicial);
  const [escolhido, setEscolhido] = useState<TipoPosVenda | null>(null);
  // Controlado: o React 19 apagaria a mensagem quando a acao respondesse com
  // erro (#130).
  const [mensagem, setMensagem] = useState('');
  const [respostas, setRespostas] = useState(0);

  const recibo = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const botoes = useRef(new Map<TipoPosVenda, HTMLButtonElement>());
  // Quem abriu a confirmacao, para o foco voltar a ele no "Voltar".
  const abriu = useRef<TipoPosVenda | null>(null);

  // Cada resposta da acao conta uma vez: e a chave do recado de erro.
  // biome-ignore lint/correctness/useExhaustiveDependencies: so a troca de estado importa
  useEffect(() => {
    setRespostas((n) => n + 1);
  }, [estado]);

  // Recebido: fecha a confirmacao, limpa a mensagem e leva o foco ao recibo.
  useEffect(() => {
    if (!estado.recebido) return;
    setEscolhido(null);
    setMensagem('');
    recibo.current?.focus();
  }, [estado.recebido]);

  // Confirmacao aberta: o foco vai para o campo, que e o proximo passo.
  useEffect(() => {
    if (escolhido) campo.current?.focus();
  }, [escolhido]);

  function voltar() {
    const alvo = abriu.current;
    setEscolhido(null);
    // Depois do quadro em que os botoes voltam a existir.
    requestAnimationFrame(() => {
      if (alvo) botoes.current.get(alvo)?.focus();
    });
  }

  const recebido = estado.recebido;

  return (
    <div className="pos-venda-pedir">
      {recebido ? (
        <div ref={recibo} className="pos-venda-recibo" role="status" tabIndex={-1}>
          <p className="pos-venda-recibo-titulo">
            {recebido.jaExistia ? 'Este pedido já estava registrado' : 'Recebemos o seu pedido'}:{' '}
            {NOME_DO_TIPO[recebido.tipo].toLowerCase()}.
          </p>
          <p>
            Protocolo <strong className="pos-venda-protocolo">{recebido.protocolo}</strong>,
            registrado em{' '}
            <time dateTime={recebido.criadoEm}>{formataDataHora(recebido.criadoEm)}</time>. Guarde
            este número. A loja responde em até {RESPOSTA_DIAS_UTEIS} dias úteis.
          </p>
        </div>
      ) : null}

      {escolhido ? (
        <form
          action={acao}
          className="pos-venda-confirmar"
          aria-labelledby="pos-venda-confirmar-titulo"
        >
          <input type="hidden" name="pedido" value={pedido} />
          <input type="hidden" name="tipo" value={escolhido} />

          <p id="pos-venda-confirmar-titulo" className="pos-venda-confirmar-titulo">
            {BOTAO_DO_TIPO[escolhido]}
          </p>
          <p className="detalhe-nota">
            {O_QUE_ACONTECE[escolhido]} A resposta vem em até {RESPOSTA_DIAS_UTEIS} dias úteis.
          </p>

          <label className="auth-campo">
            <span>{DICA_DA_MENSAGEM[escolhido]}</span>
            <textarea
              ref={campo}
              name="mensagem"
              rows={3}
              maxLength={MENSAGEM_MAX}
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
              disabled={pendente}
            />
          </label>

          <div className="pos-venda-botoes">
            <button
              type="submit"
              className={`btn cheio${pendente ? ' carregando' : ''}`}
              disabled={pendente}
            >
              Confirmar
            </button>
            <button type="button" className="btn" onClick={voltar} disabled={pendente}>
              Voltar
            </button>
          </div>

          <Mensagem
            texto={estado.erro}
            chave={respostas}
            classe="conta-recado erro"
            papel="alert"
          />
        </form>
      ) : tipos.length > 0 ? (
        <div className="pos-venda-botoes">
          {tipos.map((tipo) => (
            <button
              key={tipo}
              ref={(b) => {
                if (b) botoes.current.set(tipo, b);
                return () => {
                  botoes.current.delete(tipo);
                };
              }}
              type="button"
              className="btn"
              onClick={() => {
                abriu.current = tipo;
                setEscolhido(tipo);
              }}
            >
              {BOTAO_DO_TIPO[tipo]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
