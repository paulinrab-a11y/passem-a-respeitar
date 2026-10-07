'use client';

import { useActionState, useRef, useState } from 'react';
import Mensagem from '@/app/_ui/Mensagem';
import Reautenticar from '@/app/_ui/Reautenticar';
import Rotulo from '@/app/_ui/Rotulo';
import type { Sessao } from '@/lib/conta/sessoes';
import { formataMesAbreviadoHora } from '@/lib/datas';
import { encerrarSessao, reautenticarEEncerrar } from './acoes';
import { sessaoInicial } from './estado-sessoes';

export default function Sessoes({
  sessoes,
  janelaMinutos,
}: {
  sessoes: Sessao[];
  janelaMinutos: number;
}) {
  const [estado, acao, pendente] = useActionState(encerrarSessao, sessaoInicial);
  const [reautenticado, acaoComSenha, pendenteComSenha] = useActionState(
    reautenticarEEncerrar,
    sessaoInicial
  );

  // O identificador do que a pessoa tentou encerrar. E isto que faz a acao
  // "continuar de onde parou" depois da senha: nada e redigitado, nada se
  // perde, e ela nao precisa procurar a linha de novo numa lista que pode ter
  // mudado de ordem enquanto o modal estava aberto.
  const tentado = useRef<string | null>(null);

  const [modalFechado, setModalFechado] = useState(false);
  // Qual linha a pessoa clicou. `pendente` e da lista inteira; sem isto todos
  // os botoes diriam "Encerrando…" ao mesmo tempo (#50).
  const [clicada, setClicada] = useState<string | null>(null);
  const atual = reautenticado.recado || reautenticado.precisaReautenticar ? reautenticado : estado;
  const pedindoSenha = Boolean(atual.precisaReautenticar) && !modalFechado;

  if (sessoes.length === 0) return null;

  return (
    <section className="sessoes">
      <h2>Aparelhos conectados</h2>
      <p className="sessoes-nota">Se você não reconhece algum, encerre e troque a senha.</p>

      <ul>
        {sessoes.map((s, i) => (
          <li
            key={s.identificador}
            className={atual.encerrado === s.identificador ? 'saindo' : undefined}
            style={i < 4 ? { animationDelay: `${i * 40}ms` } : undefined}
          >
            <div className="sessoes-quem">
              <p className="sessoes-aparelho">
                {s.navegador}
                {s.sistema ? ` · ${s.sistema}` : ''}
                {s.atual ? <span className="sessoes-selo">este aparelho</span> : null}
              </p>
              <p className="sessoes-detalhe">
                {formataMesAbreviadoHora(s.ultimoAcesso)}
                {s.rede ? ` · rede ${s.rede}` : ''}
              </p>
            </div>

            {s.atual ? (
              <span className="sessoes-agora">em uso</span>
            ) : (
              <form
                action={acao}
                onSubmit={() => {
                  tentado.current = s.identificador;
                  setClicada(s.identificador);
                  setModalFechado(false);
                }}
              >
                <input type="hidden" name="identificador" value={s.identificador} />
                <button
                  type="submit"
                  className={`auth-link${pendente && clicada === s.identificador ? ' carregando' : ''}`}
                  disabled={pendente}
                >
                  <Rotulo
                    parado="Encerrar"
                    agindo="Encerrando…"
                    ativo={pendente && clicada === s.identificador}
                  />
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>

      <Mensagem
        texto={atual.recado?.texto}
        chave={atual.recado?.texto ?? ''}
        classe={`conta-recado ${atual.recado?.tom ?? 'ok'}`}
        papel="status"
      />

      {/* O formulario do modal carrega o identificador guardado. A acao do
          servidor reautentica e chama a mesma funcao de antes — nao ha um
          segundo caminho de encerramento para sair do lugar. */}
      <form action={acaoComSenha} ref={(f) => f?.classList.add('sr')}>
        <input type="hidden" name="identificador" value={tentado.current ?? ''} />
        <Reautenticar
          aberto={pedindoSenha}
          minutos={janelaMinutos}
          pendente={pendenteComSenha}
          erro={reautenticado.precisaReautenticar ? (reautenticado.recado?.texto ?? null) : null}
          onCancelar={() => setModalFechado(true)}
          onConfirmar={(senha) => {
            const dados = new FormData();
            dados.append('identificador', tentado.current ?? '');
            dados.append('senha', senha);
            acaoComSenha(dados);
          }}
        />
      </form>
    </section>
  );
}
