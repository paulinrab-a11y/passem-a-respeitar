'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Mensagem from '@/app/_ui/Mensagem';
import Rotulo from '@/app/_ui/Rotulo';
import { formataDiaHora } from '@/lib/datas';
import { ENTRAR } from '@/lib/rotas';
import { type Conferencia, conferePagamento } from './acoes';

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

/**
 * De quanto em quanto tempo a tela confere o pagamento sozinha, e por quanto
 * tempo (#250). O texto da tela e escrito com estes dois numeros: mudar um
 * aqui muda o que a pessoa le, e a promessa nao descola do que acontece.
 *
 * Dez minutos cobrem quem paga na hora. Depois disso a tela para de perguntar
 * e sobra o botao — quem deixou a aba aberta a tarde inteira nao fica batendo
 * no servidor.
 */
export const CONFERE_A_CADA_MS = 10 * 1000;
export const CONFERE_POR_MS = 10 * 60 * 1000;

/**
 * O que a tela diz quando o pedido nao mudou: toda resposta do botao, e a
 * sessao vencida que a conferencia sozinha descobre.
 */
const RECADOS: Record<Exclude<Conferencia, 'mudou'>, { tom: 'ok' | 'erro'; texto: string }> = {
  aguardando: {
    tom: 'ok',
    texto: 'O pagamento ainda não apareceu. Se você já pagou, confira de novo em instantes.',
  },
  // O Pix e do Mercado Pago, nao da sessao: pago com a sessao vencida, o
  // pedido e confirmado igual. A pessoa precisa saber que nao perdeu nada, e
  // o link de baixo vira o caminho de volta pelo login.
  'sem-sessao': {
    tom: 'erro',
    texto: 'Sua sessão expirou. O Pix continua valendo; entre de novo para ver o pedido.',
  },
  limite: { tom: 'erro', texto: 'Muitas conferências seguidas. Espere um minuto.' },
  falhou: { tom: 'erro', texto: 'Não consegui conferir agora. Tente de novo.' },
};

/**
 * Pergunta ao servidor e nunca lanca: a resposta e sempre uma palavra (#250).
 *
 * Sessao vencida quase nunca chega a acao. O proxy manda todo POST de
 * /checkout sem sessao para /entrar, o fetch da Server Action segue o
 * redirecionamento e o Next rejeita a promessa com uma resposta que nao
 * reconhece — o 'sem-sessao' da acao fica so para a sessao que cai entre o
 * proxy e ela. Rejeicao, porem, tambem e rede caida. Para separar as duas, a
 * tela pergunta a /api/conta/resumo, que fica fora das rotas com sessao
 * obrigatoria e por isso responde em vez de redirecionar.
 */
async function pergunta(pedido: string): Promise<Conferencia> {
  try {
    return await conferePagamento(pedido);
  } catch {
    return (await ninguemLogado()) ? 'sem-sessao' : 'falhou';
  }
}

/**
 * `true` so quando o servidor diz, com 200, que nao ha ninguem logado. Rede
 * caida, limite (o 429 do resumo tambem traz `logado: false`) e resposta
 * estranha sao duvida, e duvida vira "nao consegui conferir", nao "saia".
 */
async function ninguemLogado(): Promise<boolean> {
  try {
    const r = await fetch('/api/conta/resumo', { cache: 'no-store' });
    if (!r.ok) return false;
    const corpo: unknown = await r.json();
    return (corpo as { logado?: unknown } | null)?.logado === false;
  } catch {
    return false;
  }
}

export default function Pix({
  dados,
  valor,
  pedido,
}: {
  dados: DadosDoPix;
  valor: string;
  pedido: string;
}) {
  const [copiado, setCopiado] = useState(false);
  const [conferindo, comecar] = useTransition();
  const [recado, setRecado] = useState<(typeof RECADOS)[keyof typeof RECADOS] | null>(null);
  // Muda a cada resposta: a mesma frase duas vezes e anunciada duas vezes.
  const [vez, setVez] = useState(0);
  // Sessao vencida: o link de baixo leva ao login, que devolve ao pedido. O
  // estado desenha o link; a ref e o que a conferencia sozinha le, de dentro
  // do efeito, para nao perguntar (nem avisar) de novo depois que o botao ja
  // descobriu.
  const [semSessao, setSemSessao] = useState(false);
  const acabouSessao = useRef(false);
  const router = useRouter();
  const indo = useRef(false);

  const doPedido = `/conta/pedidos/${pedido}`;

  const avisa = useCallback((r: Exclude<Conferencia, 'mudou'>) => {
    setRecado(RECADOS[r]);
    setVez((v) => v + 1);
    if (r === 'sem-sessao') {
      acabouSessao.current = true;
      setSemSessao(true);
    }
  }, []);

  // A conferencia sozinha e a do botao podem responder "mudou" juntas. Vai-se
  // ao pedido uma vez so.
  const irAoPedido = useCallback(() => {
    if (indo.current) return;
    indo.current = true;
    router.push(doPedido);
  }, [router, doPedido]);

  // Conferencia sozinha (#250). Quem paga no app do banco do mesmo celular sai
  // desta aba e volta: a volta e o momento em que mais se quer saber, e por
  // isso confere na hora, sem esperar a proxima volta do relogio. Com a aba
  // escondida nao pergunta nada — ninguem esta olhando.
  //
  // So "mudou" e sessao vencida fazem algo aqui. Erro, limite e rede caida
  // ficam calados: a pessoa nao pediu esta conferencia, e um recado piscando a
  // cada 10 s por causa de um tropeco seria pior que a tela parada. O botao
  // continua ali. Sessao vencida e outra coisa: dali em diante a tela nao
  // cumpre o que o texto promete, e diz isso uma vez, parando de perguntar.
  useEffect(() => {
    const ate = Date.now() + CONFERE_POR_MS;
    let noAr = false;
    let parou = false;

    async function confere() {
      if (parou || noAr || acabouSessao.current) return;
      if (document.visibilityState !== 'visible' || Date.now() >= ate) return;
      noAr = true;
      try {
        // `pergunta` nao lanca: rede caida volta como 'falhou', e a proxima
        // volta do relogio tenta de novo.
        const r = await pergunta(pedido);
        if (parou) return;
        if (r === 'mudou') irAoPedido();
        // Sem sessao, as proximas voltariam sem sessao tambem. O aviso sai uma
        // vez: se o botao chegou antes, ele ja disse.
        if (r === 'sem-sessao' && !acabouSessao.current) avisa(r);
        if (r === 'mudou' || r === 'sem-sessao') parou = true;
      } finally {
        noAr = false;
      }
    }

    const aoVoltar = () => void confere();
    const relogio = setInterval(() => {
      if (Date.now() >= ate) clearInterval(relogio);
      else void confere();
    }, CONFERE_A_CADA_MS);
    document.addEventListener('visibilitychange', aoVoltar);

    return () => {
      parou = true;
      clearInterval(relogio);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [pedido, irAoPedido, avisa]);

  function conferir() {
    comecar(async () => {
      const r = await pergunta(pedido);
      if (r === 'mudou') {
        // A ida ao pedido fica dentro da transicao: o botao segue em
        // "Conferindo…" ate a pagina trocar, em vez de voltar ao normal por
        // um instante e convidar outro toque.
        comecar(() => irAoPedido());
        return;
      }
      avisa(r);
    });
  }

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

      {/* O que a tela faz, com os numeros do relogio de verdade. Antes dizia
          que o pedido mudava de status "aqui", e nada mudava (#250). */}
      <p className="detalhe-nota">
        Pague pelo aplicativo do seu banco. Enquanto você estiver nesta página, ela confere o
        pagamento a cada {CONFERE_A_CADA_MS / 1000} segundos, por até {CONFERE_POR_MS / 60_000}{' '}
        minutos, e abre o pedido quando ele for confirmado.
      </p>

      <button
        type="button"
        className={`btn${conferindo ? ' carregando' : ''}`}
        disabled={conferindo}
        onClick={conferir}
      >
        <Rotulo parado="Conferir pagamento" agindo="Conferindo…" ativo={conferindo} />
      </button>

      {/* Lugar reservado (#51): o recado entra sem empurrar o texto e o link
          de baixo. O recado anterior sai quando a conferencia nova comeca. */}
      <div className="erro-vaga">
        <Mensagem
          texto={recado?.texto}
          chave={vez}
          classe={`conta-recado ${recado?.tom ?? 'ok'}`}
          papel={recado?.tom === 'erro' ? 'alert' : 'status'}
          enviando={conferindo}
        />
      </div>

      {/* Nao ha e-mail de pedido ainda (#55). Quem fecha a pagina precisa
          saber onde olhar, e nao esperar uma mensagem que nao vem. */}
      <p className="detalhe-nota">
        Se fechar a página, o pagamento é confirmado do mesmo jeito. Não enviamos e-mail de pedido:
        o status fica na página do pedido.
      </p>

      {/* Mesmo lugar e mesma linha nos dois casos: trocar o link nao mexe em
          nada em volta. */}
      {semSessao ? (
        <a className="auth-link" href={`${ENTRAR}?next=${encodeURIComponent(doPedido)}`}>
          Entrar e ver o pedido
        </a>
      ) : (
        <a className="auth-link" href={doPedido}>
          Ver o pedido
        </a>
      )}
    </div>
  );
}
