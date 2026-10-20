'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { ESPERA_REENVIO_S } from '@/app/_ui/CodigoDeConfirmacao';
import { comErro, useCampos } from '@/app/_ui/campos';
import { CAMPO_DA_ISCA } from '@/app/_ui/desafio';
import Rotulo from '@/app/_ui/Rotulo';
import { CODIGO_DIGITOS } from '@/lib/conta/codigo-digitos';
import { forcaDaSenha, SENHA_MIN } from '@/lib/conta/senha';
import AvisoFlutuante from './AvisoFlutuante';
import { pedirCodigoDaSenha } from './criar-senha';
import { type EstadoCriarSenha, envioDaSenhaInicial } from './estado-criar-senha';

type Recado = { tom: 'ok' | 'erro'; texto: string };

const ENVIO = 'criar-senha-envio';
const AVISO = 'aviso-da-senha';

/**
 * "Criar senha" para a conta que entrou so pelo codigo (#389).
 *
 * A mesma forma de "Trocar senha" — tres campos, a barra de forca e o botao
 * —, com o codigo do e-mail no lugar da senha atual e o botao de pedir o
 * codigo na linha dele. Assim o esqueleto de Seguranca serve para as duas, e
 * nada se move quando a pagina chega (CLS 0).
 *
 * Pedir o codigo e outro formulario (`form` no botao), para a senha digitada
 * nao viajar junto com o pedido de e-mail.
 */
export default function CriarSenha({
  estado,
  cria,
  criando,
}: {
  /** O estado da criacao mora em `Senha`, que continua montado depois dela. */
  estado: EstadoCriarSenha;
  cria: (form: FormData) => void;
  criando: boolean;
}) {
  const [envio, pede, pedindo] = useActionState(pedirCodigoDaSenha, envioDaSenhaInicial);
  // Controlados, como na troca: o React 19 apagaria os campos quando a acao
  // respondesse com erro, e nenhum deles volta do servidor (#130).
  const { valores, campo } = useCampos({ nova: '', confirmacao: '' });
  const [codigo, setCodigo] = useState('');
  const forca = forcaDaSenha(valores.nova);
  const form = useRef<HTMLFormElement>(null);
  const campoDoCodigo = useRef<HTMLInputElement>(null);

  // A espera do reenvio comeca quando um codigo sai: o Supabase nao manda
  // outro antes de um minuto.
  const [restam, setRestam] = useState(0);
  useEffect(() => {
    if (envio.enviadoEm === null) return;
    setRestam(ESPERA_REENVIO_S);
    const id = setInterval(() => setRestam((r) => (r > 0 ? r - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [envio.enviadoEm]);

  // Um aviso por vez, o da ultima resposta, no mesmo lugar do pe da tela.
  const [recado, setRecado] = useState<Recado | null>(null);
  useEffect(() => {
    if (envio.recado) setRecado(envio.recado);
  }, [envio.recado]);
  useEffect(() => {
    // Criada, quem mostra o aviso e `Senha`: esta tela sai no mesmo quadro.
    if (estado.recado && !estado.criada) setRecado(estado.recado);
  }, [estado.recado, estado.criada]);

  // Codigo enviado: o foco vai para onde ele sera digitado.
  useEffect(() => {
    if (envio.enviadoEm !== null) campoDoCodigo.current?.focus();
  }, [envio.enviadoEm]);

  // O foco no campo que errou liga o aviso, longe dele, ao campo (#51).
  // Codigo errado ja foi gasto: o campo esvazia para o proximo.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tentativa reanima o foco quando o mesmo campo erra de novo
  useEffect(() => {
    if (!estado.campo) return;
    if (estado.campo === 'codigo') setCodigo('');
    const alvo = form.current?.elements.namedItem(estado.campo);
    if (alvo instanceof HTMLInputElement) alvo.focus();
  }, [estado.campo, estado.tentativa]);

  const jaEnviou = envio.enviadoEm !== null;
  const podePedir = restam === 0 && !pedindo && !criando;
  const nomeDoPedido = pedindo
    ? 'Enviando código'
    : restam > 0
      ? `Reenviar código em ${restam} segundos`
      : jaEnviou
        ? 'Reenviar código'
        : 'Enviar código';

  return (
    <>
      <form id={ENVIO} action={pede} hidden />

      <form action={cria} ref={form} className="conta-bloco" autoComplete="on">
        {/* A isca (#28), igual a da ContraRobo: fora da tela e do leitor. */}
        <div className="isca" aria-hidden="true">
          <label>
            Site
            <input type="text" name={CAMPO_DA_ISCA} tabIndex={-1} autoComplete="off" />
          </label>
        </div>

        {/* O botao fica fora do `label`: dentro, o texto dele entraria no
            nome do campo para quem usa leitor de tela. */}
        <div className="auth-campo">
          <span>
            <label htmlFor="criar-senha-codigo">Código do e-mail</label>
          </span>
          <div className="criar-senha-linha">
            <input
              ref={campoDoCodigo}
              id="criar-senha-codigo"
              type="text"
              name="codigo"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern={`[0-9]{${CODIGO_DIGITOS}}`}
              placeholder={`${CODIGO_DIGITOS} dígitos`}
              required
              disabled={criando}
              value={codigo}
              // So digitos: "Seu código: 1234 5678" colado vira 12345678. Sem
              // maxLength, que cortaria o colar antes daqui (#340).
              onChange={(e) =>
                setCodigo(e.target.value.replace(/\D/g, '').slice(0, CODIGO_DIGITOS))
              }
              {...comErro(estado.campo === 'codigo', AVISO)}
            />
            <button
              type="submit"
              form={ENVIO}
              className={`btn${pedindo ? ' carregando' : ''}`}
              disabled={!podePedir}
              aria-label={nomeDoPedido}
            >
              <Rotulo
                parado={restam > 0 ? `${restam} s` : jaEnviou ? 'Reenviar' : 'Enviar'}
                agindo="Enviando…"
                ativo={pedindo}
              />
            </button>
          </div>
        </div>

        <label className="auth-campo">
          <span>Nova senha</span>
          <input
            type="password"
            {...campo('nova')}
            autoComplete="new-password"
            minLength={SENHA_MIN}
            required
            disabled={criando}
            {...comErro(estado.campo === 'nova', AVISO, 'forca-da-senha')}
          />
        </label>

        {/* Sempre renderizada, mesmo vazia, como na troca: aparecer e sumir
            empurraria o resto do formulario a cada tecla. */}
        <div className="senha-forca" id="forca-da-senha">
          <div className="senha-barra" data-nivel={forca.nivel}>
            <i style={{ transform: `scaleX(${valores.nova ? (forca.nivel + 1) / 5 : 0})` }} />
          </div>
          <span aria-live="polite">{forca.rotulo}</span>
        </div>

        <label className="auth-campo">
          <span>Confirmar nova senha</span>
          <input
            type="password"
            {...campo('confirmacao')}
            autoComplete="new-password"
            required
            disabled={criando}
            {...comErro(estado.campo === 'confirmacao', AVISO)}
          />
        </label>

        <button
          type="submit"
          className={`btn auth-enviar${criando ? ' carregando' : ''}`}
          disabled={criando}
        >
          <Rotulo parado="Criar senha" agindo="Criando…" ativo={criando} />
        </button>
      </form>

      <AvisoFlutuante recado={recado} id={AVISO} />
    </>
  );
}
