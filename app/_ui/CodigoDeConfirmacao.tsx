'use client';

import { type ReactNode, useActionState, useEffect, useRef, useState } from 'react';
import ContraRobo, { SEM_AVISO } from '@/app/_ui/ContraRobo';
import { comErro } from '@/app/_ui/campos';
import { CAMPO_DA_ISCA } from '@/app/_ui/desafio';
import Erro from '@/app/_ui/Erro';
import Rotulo from '@/app/_ui/Rotulo';
import { CODIGO_DIGITOS } from '@/lib/esquemas';
import {
  codigoInicial,
  type Desfecho,
  type EstadoCodigo,
  type EstadoReenvio,
  reenvioInicial,
} from './estado-do-codigo';

/** O Supabase so manda outro e-mail depois de 60 s; a tela conta junto. */
export const ESPERA_REENVIO_S = 60;
const DIGITOS = CODIGO_DIGITOS;

type Acao<Estado> = (anterior: Estado, form: FormData) => Promise<Estado>;

/**
 * Quando o codigo conferiu mas a pessoa nao entrou (#284). O codigo ja foi
 * gasto, entao o recado substitui o campo: pedir outro codigo ali so daria
 * "inválido ou vencido".
 */
const DESFECHOS: Record<Desfecho, { titulo: string; texto: string; href: string; rotulo: string }> =
  {
    'sem-senha': {
      titulo: 'E-mail confirmado, falta a senha',
      texto:
        'Não consegui gravar a senha que você escolheu. Para entrar, crie uma senha nova em “Esqueci minha senha”: o link chega neste mesmo e-mail.',
      href: '/recuperar-senha',
      rotulo: 'Esqueci minha senha',
    },
    entrar: {
      titulo: 'Conta confirmada',
      texto: 'Sua senha está gravada. Entre com este e-mail e a senha que você acabou de escolher.',
      href: '/entrar',
      rotulo: 'Entrar',
    },
  };

function DesfechoDoCodigo({ desfecho, classe }: { desfecho: Desfecho; classe: string }) {
  const acao = useRef<HTMLAnchorElement>(null);
  const { titulo, texto, href, rotulo } = DESFECHOS[desfecho];

  // O campo do codigo, onde o foco estava, acabou de sair da tela. O foco vai
  // para o proximo passo, e o texto descreve o link: quem usa leitor de tela
  // ouve o recado inteiro ao cair nele, sem precisar procurar.
  useEffect(() => {
    acao.current?.focus();
  }, []);

  return (
    <div className={classe}>
      <p className="auth-sub">{titulo}</p>
      <p className="detalhe-nota" id="codigo-desfecho">
        {texto}
      </p>
      <a ref={acao} className="btn" href={href} aria-describedby="codigo-desfecho">
        {rotulo}
      </a>
    </div>
  );
}

/**
 * O campo do codigo de confirmacao (#224, #260), o mesmo nas tres telas que o
 * pedem: o cadastro, o login de conta ainda nao confirmada e o aviso de
 * /conta. Quem chama diz o texto, as acoes e o que vai junto no envio; o
 * campo, a espera do reenvio e o tratamento do erro sao daqui.
 *
 * Um campo so, e nao oito caixinhas: colar funciona, o teclado do celular
 * preenche sozinho (`one-time-code`) e o leitor de tela le um campo. Quando o
 * ultimo digito entra, o formulario vai sozinho — ninguem precisa achar o
 * botao com o e-mail aberto do outro lado. O botao continua la para quem
 * digita devagar ou cola errado.
 *
 * O texto de cima descreve o campo (`aria-describedby`): quem chega pelo
 * leitor de tela cai no campo, e e ali que ouve por que ele apareceu.
 */
export default function CodigoDeConfirmacao({
  titulo,
  intro,
  confirmar,
  reenviar,
  ocultos = {},
  desafio = true,
  esperaInicialS = ESPERA_REENVIO_S,
  foco = true,
  rotuloDoReenvio = 'Reenviar código',
  voltar,
  classe = 'auth-form codigo-tela',
  children,
}: {
  titulo?: string;
  intro: ReactNode;
  confirmar: Acao<EstadoCodigo>;
  reenviar: Acao<EstadoReenvio>;
  /** Vai junto nos dois envios: e-mail, `next`, manter conectado. */
  ocultos?: Record<string, string>;
  /**
   * Protecao contra bot no reenvio (#28). Desligada so onde a sessao ja diz
   * quem pede, em /conta — e la a CSP nem abre o iframe da Cloudflare.
   */
  desafio?: boolean;
  /**
   * Quanto o reenvio espera quando a tela abre. 60 s quando um e-mail acabou
   * de sair; zero em /conta, onde nada saiu ainda.
   */
  esperaInicialS?: number;
  /** Foco no campo ao abrir. So quando a tela existe para ele. */
  foco?: boolean;
  rotuloDoReenvio?: string;
  voltar?: { rotulo: string; aoClicar: () => void };
  classe?: string;
  children?: ReactNode;
}) {
  const [estado, confirma, confirmando] = useActionState(confirmar, codigoInicial);
  const [reenvio, reenvia, reenviando] = useActionState(reenviar, reenvioInicial);
  const [codigo, setCodigo] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const [robo, setRobo] = useState(SEM_AVISO);

  // Contagem do reenvio: comeca com a espera de quem chamou e recomeca cheia
  // a cada reenvio que deu certo. Zerada, nao ha o que contar.
  const [restam, setRestam] = useState(esperaInicialS);
  useEffect(() => {
    const inicio = reenvio.reenviadoEm === null ? esperaInicialS : ESPERA_REENVIO_S;
    setRestam(inicio);
    if (inicio === 0) return;
    const id = setInterval(() => setRestam((r) => (r > 0 ? r - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [reenvio.reenviadoEm, esperaInicialS]);

  // Codigo errado: limpa e devolve o foco, para digitar o proximo sem apagar.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tentativa marca cada resposta
  useEffect(() => {
    if (!estado.erro) return;
    setCodigo('');
    campo.current?.focus();
  }, [estado.tentativa]);

  function aoDigitar(valor: string) {
    // So digitos, no maximo DIGITOS: "Seu código: 1234 5678" colado vira 12345678.
    const limpo = valor.replace(/\D/g, '').slice(0, DIGITOS);
    setCodigo(limpo);
    if (limpo.length === DIGITOS && !confirmando) {
      // Espera o React gravar o valor no campo antes de enviar o formulario.
      queueMicrotask(() => form.current?.requestSubmit());
    }
  }

  // Depois de todos os hooks: a ordem deles nao pode mudar entre as renderizacoes.
  // A troca de componente remonta a caixa, e a entrada da `.codigo-tela` roda
  // de novo para o recado.
  if (estado.desfecho) return <DesfechoDoCodigo desfecho={estado.desfecho} classe={classe} />;

  const podeReenviar = restam === 0 && !reenviando && !robo.esperando;
  const recado = reenvio.erro ?? robo.aviso ?? reenvio.aviso;
  const camposOcultos = Object.entries(ocultos).map(([nome, valor]) => (
    <input key={nome} type="hidden" name={nome} value={valor} />
  ));

  return (
    <div className={classe}>
      {titulo ? <p className="auth-sub">{titulo}</p> : null}
      <p className="detalhe-nota" id="codigo-intro">
        {intro}
      </p>

      <form action={confirma} ref={form} className="codigo-form" noValidate>
        {camposOcultos}
        {/* A isca (#28), igual a da ContraRobo: fora da tela e do leitor. */}
        <div className="isca" aria-hidden="true">
          <label>
            Site
            <input type="text" name={CAMPO_DA_ISCA} tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        <label className="auth-campo codigo-campo">
          <span>Código de {DIGITOS} dígitos</span>
          <input
            ref={campo}
            type="text"
            name="codigo"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern={`[0-9]{${DIGITOS}}`}
            maxLength={DIGITOS}
            required
            // biome-ignore lint/a11y/noAutofocus: so quando a tela existe para este campo; o foco e o que a pessoa espera
            autoFocus={foco}
            disabled={confirmando}
            value={codigo}
            onChange={(e) => aoDigitar(e.target.value)}
            {...comErro(Boolean(estado.erro), 'codigo-erro', 'codigo-intro')}
          />
        </label>

        <Erro
          id="codigo-erro"
          texto={estado.erro}
          tentativa={estado.tentativa}
          enviando={confirmando}
        />

        <button
          type="submit"
          className={`btn auth-enviar${confirmando ? ' carregando' : ''}`}
          disabled={confirmando || codigo.length < DIGITOS}
        >
          <Rotulo parado="Confirmar" agindo="Confirmando…" ativo={confirmando} />
        </button>
      </form>

      <form action={reenvia} className="codigo-reenvio" noValidate>
        {camposOcultos}
        {desafio ? (
          <ContraRobo acao="reenviar-codigo" tentativa={reenvio.tentativa} aoMudar={setRobo} />
        ) : null}
        <Erro
          id="reenvio-recado"
          texto={recado}
          tentativa={robo.aviso ? `robo-${robo.vez}` : reenvio.tentativa}
          enviando={reenviando}
          classe={reenvio.erro || robo.aviso ? 'auth-erro' : 'auth-erro auth-aviso'}
        />
        <div className="codigo-acoes">
          <button
            type="submit"
            className={`btn${reenviando || robo.esperando ? ' carregando' : ''}`}
            disabled={!podeReenviar}
          >
            <Rotulo
              parado={restam > 0 ? `${rotuloDoReenvio} (${restam} s)` : rotuloDoReenvio}
              agindo="Enviando…"
              ativo={reenviando || robo.esperando}
            />
          </button>
          {voltar ? (
            <button type="button" className="btn" onClick={voltar.aoClicar}>
              {voltar.rotulo}
            </button>
          ) : null}
        </div>
      </form>

      {children}
    </div>
  );
}
