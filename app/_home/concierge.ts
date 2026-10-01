import type { desafioDoConvite } from './desafio-do-convite';

/**
 * O painel do Concierge na home (Issue #191).
 *
 * Um chat pequeno, fixo no canto, que conversa com `/api/concierge`. O que
 * mora aqui e so o navegador: abrir, fechar, mandar, mostrar. Quem sabe do
 * EP e o servidor; quem segura a voz e o prompt de la.
 *
 * Memoria: as ultimas trocas ficam num array e vao junto com cada pergunta.
 * Somem quando a aba fecha. Nada em `localStorage` — conversa de visitante
 * nao e coisa para ficar gravada no computador dele sem ele pedir.
 *
 * Animacao: as mesmas classes dos modais (`on`, `saindo`, `animationend`),
 * para abrir e fechar do jeito que a sala e a loja fazem. So `transform` e
 * `opacity`; a duracao e a do CSS, e o `prefers-reduced-motion` tambem.
 */

type Humano = ReturnType<typeof desafioDoConvite>;

type Papel = 'usuario' | 'concierge';
type Troca = { papel: Papel; texto: string };
type Resposta = { ok?: boolean; resposta?: string; erro?: string };

/** Quantas trocas vao junto: o servidor recusa mais que isso. */
const HISTORICO_MAX = 8;

const ABERTURA = 'Pergunta o que quiser sobre o EP, a camiseta ou o clipe.';
const ERRO_GENERICO = 'O concierge saiu por um instante. Tenta de novo em alguns segundos.';
const ERRO_DE_LIMITE = 'Muitas perguntas de uma vez. Espera um pouco e tenta de novo.';
const ERRO_DE_REDE = 'Sem conexão agora. Tenta de novo.';
const PEDINDO_HUMANO = 'Confirma que é humano na caixa abaixo.';

/** Quanto o fechamento pode demorar antes de a gente desistir de esperar o CSS. */
const PRAZO_DE_SAIDA_MS = 400;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

export default function montaConcierge({ humano }: { humano: Humano }) {
  const abrir = $<HTMLButtonElement>('abrirConcierge');
  const painel = $<HTMLElement>('concierge');
  const fechar = $<HTMLButtonElement>('fecharConcierge');
  const lista = $<HTMLElement>('conciergeLista');
  const form = $<HTMLFormElement>('formConcierge');
  const campo = $<HTMLTextAreaElement>('conciergeTexto');
  const enviar = $<HTMLButtonElement>('enviarConcierge');
  const digitando = $<HTMLElement>('conciergeDigitando');
  const aviso = $<HTMLElement>('conciergeAviso');

  if (
    !abrir ||
    !painel ||
    !fechar ||
    !lista ||
    !form ||
    !campo ||
    !enviar ||
    !digitando ||
    !aviso
  ) {
    return;
  }

  liga({ abrir, painel, fechar, lista, form, campo, enviar, digitando, aviso }, humano);
}

type Elementos = {
  abrir: HTMLButtonElement;
  painel: HTMLElement;
  fechar: HTMLButtonElement;
  lista: HTMLElement;
  form: HTMLFormElement;
  campo: HTMLTextAreaElement;
  enviar: HTMLButtonElement;
  digitando: HTMLElement;
  aviso: HTMLElement;
};

/**
 * Separado de `montaConcierge` por causa do TypeScript: as funcoes de dentro
 * sao declaracoes, e declaracao nao herda o estreitamento de tipo do `if`
 * que vem antes dela. Aqui os elementos ja chegam sem `null`.
 */
function liga(el: Elementos, humano: Humano) {
  const { abrir, painel, fechar, lista, form, campo, enviar, digitando, aviso } = el;
  const isca = form.querySelector<HTMLInputElement>('[name="website"]');

  const historico: Troca[] = [];
  let aberto = false;
  let mandando = false;
  let prazoDeSaida = 0;

  // -------------------------------------------------------------------------
  // Mensagens
  // -------------------------------------------------------------------------

  function bolha(papel: Papel, texto: string) {
    const el = document.createElement('div');
    el.className = `concierge-bolha ${papel}`;
    el.textContent = texto;
    lista.appendChild(el);
    lista.scrollTop = lista.scrollHeight;
  }

  function guarda(papel: Papel, texto: string) {
    historico.push({ papel, texto });
    while (historico.length > HISTORICO_MAX) historico.shift();
  }

  function mostraAviso(texto: string) {
    aviso.textContent = texto;
  }

  // -------------------------------------------------------------------------
  // Abrir e fechar
  // -------------------------------------------------------------------------

  function terminaDeFechar() {
    window.clearTimeout(prazoDeSaida);
    if (!painel.classList.contains('saindo')) return;
    painel.classList.remove('on', 'saindo');
    painel.hidden = true;
    abrir.setAttribute('aria-expanded', 'false');
    abrir.focus({ preventScroll: true });
  }

  painel.addEventListener('animationend', (e) => {
    if (e.target === painel) terminaDeFechar();
  });

  function abre() {
    if (aberto) return;
    aberto = true;
    window.clearTimeout(prazoDeSaida);
    painel.hidden = false;
    painel.classList.remove('saindo');
    painel.classList.add('on');
    abrir.setAttribute('aria-expanded', 'true');
    if (lista.childElementCount === 0) bolha('concierge', ABERTURA);
    // O token e pedido quando a pessoa chega, nao quando a home carrega.
    humano?.aquece();
    campo.focus({ preventScroll: true });
  }

  function fecha() {
    if (!aberto || painel.classList.contains('saindo')) return;
    aberto = false;
    painel.classList.add('saindo');
    prazoDeSaida = window.setTimeout(terminaDeFechar, PRAZO_DE_SAIDA_MS);
  }

  abrir.addEventListener('click', () => (aberto ? fecha() : abre()));
  fechar.addEventListener('click', fecha);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && aberto) fecha();
  });

  // -------------------------------------------------------------------------
  // Enviar
  // -------------------------------------------------------------------------

  function ocupado(sim: boolean) {
    mandando = sim;
    enviar.disabled = sim;
    campo.readOnly = sim;
    digitando.classList.toggle('on', sim);
    digitando.setAttribute('aria-hidden', sim ? 'false' : 'true');
    if (sim) lista.scrollTop = lista.scrollHeight;
  }

  async function manda() {
    if (mandando) return;
    const mensagem = campo.value.trim();
    if (!mensagem) {
      campo.focus();
      return;
    }

    mostraAviso('');
    bolha('usuario', mensagem);
    const enviado = historico.slice();
    guarda('usuario', mensagem);
    campo.value = '';
    ocupado(true);

    try {
      const desafio = humano ? await humano.pede(() => mostraAviso(PEDINDO_HUMANO)) : undefined;
      if (humano) mostraAviso('');

      const r = await fetch('/api/concierge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mensagem,
          historico: enviado,
          desafio,
          website: isca ? isca.value : '',
        }),
      });
      const dados: Resposta = await r.json().catch(() => ({}));

      if (r.ok && dados.ok && typeof dados.resposta === 'string') {
        bolha('concierge', dados.resposta);
        guarda('concierge', dados.resposta);
      } else if (r.status === 429) {
        mostraAviso(ERRO_DE_LIMITE);
      } else if (r.status === 403 && dados.erro) {
        mostraAviso(dados.erro);
      } else {
        mostraAviso(ERRO_GENERICO);
      }
    } catch {
      mostraAviso(ERRO_DE_REDE);
    } finally {
      ocupado(false);
      // Token vale um envio: o proximo precisa de outro.
      humano?.renova();
      if (aberto) campo.focus({ preventScroll: true });
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void manda();
  });

  // Enter manda; Shift+Enter quebra linha, como em qualquer chat.
  campo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void manda();
    }
  });
}
