'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useCampos } from '@/app/_ui/campos';
import Mensagem from '@/app/_ui/Mensagem';
import Reautenticar from '@/app/_ui/Reautenticar';
import { proximosDe, type StatusPedido, VERBO } from '@/lib/loja/status-do-pedido';
import { mudarStatus, reautenticarEMudar } from './acoes';
import { adminInicial } from './estado';

/**
 * Os botoes de um pedido (Issue #43).
 *
 * Um formulario por pedido, um botao por transicao permitida. Nao ha
 * <select> com todos os status: o que nao pode ser feito nao aparece, e
 * isso e o que impede o erro antes de ele existir. O `motivo` e um campo
 * so, opcional, que vale para o botao clicado.
 *
 * Quando o status muda, os botoes da etapa seguinte entram com fade (#157).
 * So opacidade e um deslocamento por `transform`: nada que ocupe espaco, e o
 * card nao e empurrado. Na carga da pagina nao ha entrada — sao cinquenta
 * cards, e todos animando juntos nao dizem qual mudou.
 *
 * Reembolsar e cancelar podem responder "precisa da senha" (#351). O modal
 * da #40 pede a senha e a acao refaz a MESMA mudanca — botao e motivo
 * guardados aqui —, sem a pessoa clicar de novo.
 *
 * Marcar enviado leva o codigo de rastreio (#378). Os campos so existem na
 * etapa em que "Marcar enviado" e um dos botoes, e ficam DEPOIS dos botoes,
 * dentro do bloco que entra com a etapa: em cima, empurrariam os botoes para
 * baixo no instante da troca — e o criterio da #157 e que eles nao saiam do
 * lugar. O `required` do codigo vale so para esse botao: os outros levam
 * `formNoValidate`, e cancelar nao pede codigo nenhum.
 */
export default function MudarStatus({ pedido, status }: { pedido: string; status: StatusPedido }) {
  const [estadoDoBotao, acao, pendenteDoBotao] = useActionState(mudarStatus, adminInicial);
  const [estadoDaSenha, acaoComSenha, pendenteComSenha] = useActionState(
    reautenticarEMudar,
    adminInicial
  );
  // Qual das duas acoes respondeu por ultimo. E a resposta dela que a tela
  // mostra: um clique depois da senha nao pode ficar com o recado antigo.
  const [fonte, setFonte] = useState<'botao' | 'senha'>('botao');
  const estado = fonte === 'senha' ? estadoDaSenha : estadoDoBotao;
  const pendente = pendenteDoBotao || pendenteComSenha;
  const [modalFechado, setModalFechado] = useState(false);
  const pedindoSenha =
    Boolean(estado.precisaReautenticar) && estado.pedido === pedido && !modalFechado;
  const destinos = proximosDe(status);
  // Qual botao foi clicado. `pendente` e do formulario inteiro; sem isto as
  // tres transicoes carregariam juntas e nao daria para saber qual saiu (#50).
  const [clicado, setClicado] = useState<string | null>(null);
  // Controlado: o React 19 apagaria o motivo quando a acao respondesse com
  // erro (#130). No sucesso ele sai, para nao valer para a proxima etapa.
  const { campo, limpar } = useCampos({ motivo: '', rastreio: '', rastreioUrl: '' });
  const motivoAtual = campo('motivo').value;
  // Para onde o foco volta quando o modal sai: o botao que pediu a senha.
  const botoes = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (estado.recado?.tom === 'ok' && estado.pedido === pedido) limpar();
  }, [estado.recado, estado.pedido, pedido, limpar]);

  // O status com que o card chegou. Diferente dele, houve mudanca nesta
  // visita, e o que entra agora entra animado.
  const deChegada = useRef(status);
  const mudou = status !== deChegada.current;

  const recado = (
    <Mensagem
      texto={estado.pedido === pedido ? estado.recado?.texto : null}
      chave={estado.recado?.texto ?? ''}
      classe={`conta-recado ${estado.recado?.tom ?? 'erro'}`}
      papel="alert"
    />
  );

  if (destinos.length === 0) {
    return (
      <div className="admin-acoes">
        <p className={`detalhe-nota admin-final${mudou ? ' entrou' : ''}`}>Sem próxima etapa.</p>
        {/* A ultima mudanca tambem merece o "status atualizado": antes o
            recado morava dentro do formulario e sumia junto com ele. */}
        {recado}
      </div>
    );
  }

  return (
    <>
      <form
        action={acao}
        className="admin-acoes"
        onSubmit={() => {
          setFonte('botao');
          setModalFechado(false);
        }}
      >
        <input type="hidden" name="pedido" value={pedido} />

        <label className="auth-campo">
          <span>Motivo (opcional)</span>
          <input {...campo('motivo')} type="text" maxLength={300} disabled={pendente} />
        </label>

        {/* A `key` troca o bloco inteiro quando o status muda: os botoes da
          etapa nova sao elementos novos, e a entrada roda de novo. */}
        <div key={status} className={`admin-botoes${mudou ? ' entrou' : ''}`}>
          {destinos.map((para) => (
            <button
              key={para}
              ref={(b) => {
                if (b) botoes.current.set(para, b);
                return () => {
                  botoes.current.delete(para);
                };
              }}
              type="submit"
              name="para"
              value={para}
              disabled={pendente}
              onClick={() => setClicado(para)}
              formNoValidate={para !== 'enviado'}
              className={`btn${para === 'cancelado' || para === 'reembolsado' ? '' : ' cheio'}${pendente && clicado === para ? ' carregando' : ''}`}
            >
              {VERBO[para]}
            </button>
          ))}

          {destinos.includes('enviado') ? (
            <div className="admin-rastreio">
              <label className="auth-campo">
                <span>Código de rastreio (para marcar enviado)</span>
                <input
                  {...campo('rastreio')}
                  type="text"
                  required
                  maxLength={40}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="AB123456789BR"
                  disabled={pendente}
                />
              </label>
              <label className="auth-campo">
                <span>Link de rastreio (opcional)</span>
                <input
                  {...campo('rastreioUrl')}
                  type="url"
                  maxLength={500}
                  autoComplete="off"
                  placeholder="https://"
                  disabled={pendente}
                />
              </label>
            </div>
          ) : null}
        </div>

        {/* O que cada botao faz com o dinheiro (#22): reembolsar estorna no
          provedor antes de mudar o status; cancelar so muda o status. Texto
          fixo por etapa e fora do bloco animado — e contexto, nao novidade. */}
        {destinos.includes('reembolsado') ? (
          <p className="detalhe-nota admin-nota">
            Reembolsar estorna o pagamento no Mercado Pago e só então muda o status.
            {destinos.includes('cancelado') ? ' Cancelar não devolve o dinheiro.' : ''}
          </p>
        ) : null}

        {recado}
      </form>

      {/* A senha da #40 (#351). O modal sai por portal; este formulario so
        existe para a acao com senha ter onde morar. */}
      <form action={acaoComSenha} className="sr">
        <Reautenticar
          aberto={pedindoSenha}
          minutos={estado.precisaReautenticar?.minutos ?? 15}
          pendente={pendenteComSenha}
          erro={
            fonte === 'senha' && estadoDaSenha.precisaReautenticar
              ? (estadoDaSenha.recado?.texto ?? null)
              : null
          }
          onCancelar={() => setModalFechado(true)}
          devolverFoco={() => (clicado ? (botoes.current.get(clicado) ?? null) : null)}
          onConfirmar={(senha) => {
            const dados = new FormData();
            dados.append('pedido', pedido);
            dados.append('para', clicado ?? '');
            dados.append('motivo', motivoAtual);
            dados.append('senha', senha);
            setFonte('senha');
            acaoComSenha(dados);
          }}
        />
      </form>
    </>
  );
}
