/**
 * O Cloudflare Turnstile no navegador (Issue #28).
 *
 * Aqui so se pede o token. Quem confere e o servidor, em `lib/robo.ts`: o que
 * este arquivo faz ou deixa de fazer nao decide nada.
 *
 * O script entra por `createElement`, e nao por tag no HTML, por dois motivos:
 * so carrega onde ha formulario para proteger, e herda a confianca do script
 * que o criou — a CSP usa `strict-dynamic`, e nenhum host precisou entrar em
 * `script-src`.
 */

/** Publica de proposito: vai para o bundle. Sozinha ela nao confere nada. */
export const CHAVE_DO_DESAFIO = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

/** O nome que o servidor le. Igual a `CAMPO_DO_DESAFIO`, em `lib/robo.ts`. */
export const CAMPO_DO_DESAFIO = 'cf-turnstile-response';

/** Igual a `CAMPO_DA_ISCA`, em `lib/robo.ts`. */
export const CAMPO_DA_ISCA = 'website';

/**
 * A largura minima do widget no formato largo. Em lugar mais estreito que
 * isso ele nao encolhe: estica o formulario. Medido em tela de 320 px, onde o
 * formulario tem 284. Ali vai o formato compacto, que e mais estreito e mais
 * alto — e o CSS reserva a altura dele na mesma largura de tela.
 */
const LARGURA_MINIMA = 300;

/** Quanto um envio espera pelo token antes de desistir. */
export const ESPERA_MS = 15000;

/**
 * O mesmo, quando a Cloudflare pediu que a pessoa marque a caixa: ai quem
 * demora e gente, e gente le, procura a caixa e clica.
 */
export const ESPERA_DA_PESSOA_MS = 120000;

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type Opcoes = {
  sitekey: string;
  action: string;
  theme: 'dark';
  language: 'pt-br';
  size: 'flexible' | 'compact';
  appearance: 'always' | 'interaction-only';
  'response-field': false;
  'refresh-expired': 'auto';
  retry: 'auto';
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => boolean;
  'before-interactive-callback': () => void;
  'after-interactive-callback': () => void;
};

type Turnstile = {
  render: (onde: HTMLElement, opcoes: Opcoes) => string | null | undefined;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

let carga: Promise<Turnstile> | null = null;

function carrega(): Promise<Turnstile> {
  carga ??= new Promise<Turnstile>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => {
      const t = (window as unknown as { turnstile?: Turnstile }).turnstile;
      if (t) resolve(t);
      else reject(new Error('turnstile: o script carregou sem o objeto'));
    };
    s.onerror = () => {
      // Bloqueador ou rede: a proxima tentativa comeca do zero.
      carga = null;
      s.remove();
      reject(new Error('turnstile: o script nao carregou'));
    };
    document.head.appendChild(s);
  });
  return carga;
}

export type Desafio = {
  /** Joga fora o token atual e pede outro: cada token vale um envio. */
  renova: () => void;
  desmonta: () => void;
};

/**
 * Monta o widget em `onde`.
 *
 * `aoMudar` recebe o token quando ele chega e `''` quando ele deixa de valer
 * (venceu, foi gasto, deu erro). `aoFalhar` avisa que nao ha widget, ou que
 * ele desistiu.
 *
 * `aoPedir` avisa que a Cloudflare nao se convenceu sozinha e quer que a
 * pessoa marque a caixa (`true`), e depois que ela marcou (`false`). Enquanto
 * isso o token nao vem, por mais que se espere.
 *
 * `discreto` so mostra o widget quando a Cloudflare precisa que a pessoa faca
 * alguma coisa. E o modo da home, onde nao ha lugar reservado para ele.
 */
export function montaDesafio(
  onde: HTMLElement,
  {
    acao,
    discreto = false,
    aoMudar,
    aoFalhar,
    aoPedir,
  }: {
    acao: string;
    discreto?: boolean;
    aoMudar: (token: string) => void;
    aoFalhar: () => void;
    aoPedir: (pedindo: boolean) => void;
  }
): Desafio {
  let id: string | null = null;
  let vivo = true;

  carrega()
    .then((t) => {
      if (!vivo) return;
      id =
        t.render(onde, {
          sitekey: CHAVE_DO_DESAFIO,
          action: acao,
          theme: 'dark',
          language: 'pt-br',
          // No modo discreto o lugar nao tem largura ate o widget aparecer, e
          // nao ha o que medir: vai o compacto, que cabe em qualquer tela.
          size: discreto || onde.clientWidth < LARGURA_MINIMA ? 'compact' : 'flexible',
          appearance: discreto ? 'interaction-only' : 'always',
          // O campo escondido e nosso, controlado pelo React: o do widget
          // perderia o valor quando o formulario e limpo depois da acao.
          'response-field': false,
          'refresh-expired': 'auto',
          retry: 'auto',
          callback: aoMudar,
          'expired-callback': () => aoMudar(''),
          'error-callback': () => {
            aoMudar('');
            aoFalhar();
            // `true` diz ao widget que o erro foi tratado; ele continua
            // tentando sozinho, e se conseguir o token chega por `callback`.
            return true;
          },
          'before-interactive-callback': () => aoPedir(true),
          'after-interactive-callback': () => aoPedir(false),
        }) ?? null;
      if (!id) aoFalhar();
    })
    .catch(() => {
      if (vivo) aoFalhar();
    });

  const turnstile = () => (window as unknown as { turnstile?: Turnstile }).turnstile;

  return {
    renova() {
      aoMudar('');
      // Desafio novo: se vai precisar da pessoa, a Cloudflare diz de novo.
      aoPedir(false);
      if (id) turnstile()?.reset(id);
    },
    desmonta() {
      vivo = false;
      if (id) turnstile()?.remove(id);
      id = null;
    },
  };
}
