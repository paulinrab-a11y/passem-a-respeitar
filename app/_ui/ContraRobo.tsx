'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CAMPO_DA_ISCA,
  CAMPO_DO_DESAFIO,
  CHAVE_DO_DESAFIO,
  type Desafio,
  ESPERA_MS,
  montaDesafio,
} from './desafio';

/** Diz o que aconteceu e o que fazer: bloqueador e o motivo de quase sempre. */
const NAO_CARREGOU =
  'A verificação contra robôs não carregou. Desligue o bloqueador para este site e recarregue a página.';

/** O texto entre aspas e o que a Cloudflare escreve na caixa, em portugues. */
const CONFIRME = 'Marque “Confirme que é humano” na caixa acima e envie de novo.';

/** O que a protecao contra bot conta ao formulario. */
export type Aviso = {
  /** Um envio esta guardado, esperando o token. O botao mostra que esta andando. */
  esperando: boolean;
  /** O que dizer a pessoa, no lugar do erro do formulario. */
  aviso: string | null;
  /** Muda a cada aviso: o mesmo aviso de novo e anunciado, e animado, de novo. */
  vez: number;
};

export const SEM_AVISO: Aviso = { esperando: false, aviso: null, vez: 0 };

/**
 * Protecao contra bot de um formulario (Issue #28): a isca e o desafio.
 *
 * Vai DENTRO do `<form>`, e manda dois campos junto com os outros. Quem
 * confere os dois e o servidor.
 *
 * O lugar do widget existe desde o primeiro quadro, com a altura dele: o
 * widget chega depois, de outro host, e nao pode empurrar o botao. O que ha
 * para dizer a pessoa vai para o formulario, por `aoMudar`, e aparece no lugar
 * do erro — que tambem ja esta reservado.
 *
 * Envio sem token tem tres destinos, conforme o que o widget esta fazendo:
 *
 *   - Conferindo sozinho: o envio espera e sai quando o token chega. Quem usa
 *     gerenciador de senha preenche e envia antes do token; devolver erro
 *     seria castigar a pressa.
 *   - Pedindo que a pessoa marque a caixa: o envio nao espera. O token so vem
 *     depois de um clique que a pessoa ainda nao sabe que precisa dar; o
 *     formulario diz isso, e ela envia de novo.
 *   - Nao carregou: o envio segue, e quem recusa e o servidor.
 */
export default function ContraRobo({
  acao,
  tentativa,
  aoMudar,
}: {
  acao: string;
  /** O contador de envios do formulario: a cada resposta, um token novo. */
  tentativa: number;
  aoMudar?: (aviso: Aviso) => void;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const desafio = useRef<Desafio | null>(null);
  const [token, setToken] = useState('');

  // O que o ouvinte de `submit` e os avisos do widget leem. Em ref, e nao em
  // estado: sao registrados uma vez e precisam do valor de agora.
  const agora = useRef({
    token: '',
    falhou: false,
    pedindo: false,
    prazo: 0,
    contado: SEM_AVISO,
    aoMudar,
  });
  agora.current.aoMudar = aoMudar;

  useEffect(() => {
    const onde = caixa.current;
    const form = onde?.closest('form');
    if (!CHAVE_DO_DESAFIO || !onde || !form) return;

    const a = agora.current;

    function conta(esperando: boolean, aviso: string | null) {
      if (a.contado.esperando === esperando && a.contado.aviso === aviso) return;
      a.contado = { esperando, aviso, vez: a.contado.vez + 1 };
      a.aoMudar?.(a.contado);
    }

    function paraDeEsperar() {
      window.clearTimeout(a.prazo);
      a.prazo = 0;
    }

    function falha() {
      a.falhou = true;
      // Quem estava esperando nao espera mais: o envio nao sai.
      paraDeEsperar();
      conta(false, NAO_CARREGOU);
    }

    desafio.current = montaDesafio(onde, {
      acao,
      aoMudar(novo) {
        a.token = novo;
        setToken(novo);
        if (!novo) return;

        a.falhou = false;
        a.pedindo = false;
        // O envio guardado sai no efeito abaixo, e e ele que avisa o
        // formulario. Sem envio guardado, o que havia para dizer ja passou.
        if (!a.prazo) conta(false, null);
      },
      aoFalhar: falha,
      aoPedir(pedindo) {
        a.pedindo = pedindo;
        // Enviou, e so depois a Cloudflare resolveu pedir a caixa: a espera
        // acaba aqui, com o pedido no lugar dela.
        if (pedindo && a.prazo) {
          paraDeEsperar();
          conta(false, CONFIRME);
        }
      },
    });

    // Ouvinte nativo, no proprio formulario: roda antes do React, que ouve na
    // raiz, e o React nao dispara a acao de um envio que ja foi cancelado.
    function aoEnviar(e: SubmitEvent) {
      if (a.token || a.falhou) return;
      e.preventDefault();

      if (a.pedindo) {
        // `vez` novo a cada envio: quem insiste sem marcar le o aviso de novo.
        a.contado = { esperando: false, aviso: CONFIRME, vez: a.contado.vez + 1 };
        a.aoMudar?.(a.contado);
        return;
      }

      if (a.prazo) return;
      a.prazo = window.setTimeout(falha, ESPERA_MS);
      conta(true, null);
    }
    form.addEventListener('submit', aoEnviar);

    return () => {
      form.removeEventListener('submit', aoEnviar);
      paraDeEsperar();
      desafio.current?.desmonta();
      desafio.current = null;
    };
  }, [acao]);

  // O envio que estava esperando sai aqui, e nao na chegada do token: efeito
  // roda depois do commit, entao o campo escondido ja esta no DOM com o
  // valor, e e do DOM que o formulario e lido.
  useEffect(() => {
    const a = agora.current;
    if (!token || !a.prazo) return;
    window.clearTimeout(a.prazo);
    a.prazo = 0;
    caixa.current?.closest('form')?.requestSubmit();
    // Depois do envio, e no mesmo lote: o botao passa de "esperando o token"
    // para "enviando" sem um quadro parado no meio.
    a.contado = { esperando: false, aviso: null, vez: a.contado.vez + 1 };
    a.aoMudar?.(a.contado);
  }, [token]);

  // Token vale um envio. A resposta chegou: o que foi junto esta gasto.
  //
  // E o aviso daqui sai da frente. Ele usa o lugar do erro do formulario, e
  // quem acabou de falar foi o servidor: se o widget nao carregou e a pessoa
  // enviou mesmo assim, o que ela precisa ler e a recusa, que e nova.
  useEffect(() => {
    if (tentativa === 0) return;
    desafio.current?.renova();

    const a = agora.current;
    if (a.contado.aviso === null) return;
    a.contado = { esperando: false, aviso: null, vez: a.contado.vez + 1 };
    a.aoMudar?.(a.contado);
  }, [tentativa]);

  return (
    <>
      {/* Fora da tela, fora do teclado e fora do leitor de tela. Sem
          `display:none`: script que preenche tudo costuma pular campo que
          nao e renderizado. */}
      <div className="isca" aria-hidden="true">
        <label>
          Site
          <input type="text" name={CAMPO_DA_ISCA} tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {CHAVE_DO_DESAFIO ? (
        <div className="desafio">
          <div ref={caixa} />
          <input type="hidden" name={CAMPO_DO_DESAFIO} value={token} />
        </div>
      ) : null}
    </>
  );
}
