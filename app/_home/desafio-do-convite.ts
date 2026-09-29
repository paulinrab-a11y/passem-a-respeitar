import {
  CHAVE_DO_DESAFIO,
  type Desafio,
  ESPERA_DA_PESSOA_MS,
  ESPERA_MS,
  montaDesafio,
} from '@/app/_ui/desafio';

/**
 * A protecao contra bot do campo de convite (Issue #28).
 *
 * Diferente dos formularios de conta em duas coisas, e as duas por causa da
 * home:
 *
 *   - Preguicosa. O script da Cloudflare so carrega quando a pessoa chega no
 *     campo. Quem abre a home para ouvir o EP nao carrega nada de fora.
 *   - Discreta. O widget so aparece se a Cloudflare precisar que a pessoa
 *     faca alguma coisa; a home nao ganha uma caixa nova.
 *
 * Sem chave configurada devolve `null`, e o script da home segue como antes.
 */
export function desafioDoConvite(onde: HTMLElement | null) {
  if (!CHAVE_DO_DESAFIO || !onde) return null;
  const caixa = onde;

  let desafio: Desafio | null = null;
  let token = '';
  let pedindo = false;
  let fila: { responde: (token: string) => void; aoPedir: () => void; prazo: number }[] = [];

  function responde(valor: string) {
    const esperando = fila;
    fila = [];
    for (const f of esperando) {
      window.clearTimeout(f.prazo);
      f.responde(valor);
    }
  }

  function aquece() {
    if (desafio) return;
    desafio = montaDesafio(caixa, {
      acao: 'convite',
      discreto: true,
      aoMudar(novo) {
        token = novo;
        if (!novo) return;
        pedindo = false;
        responde(novo);
      },
      aoFalhar() {
        // Desmontado, para a proxima tentativa comecar do zero: a falha pode
        // ter sido a rede, e a rede volta.
        desafio?.desmonta();
        desafio = null;
        token = '';
        pedindo = false;
        responde('');
      },
      aoPedir(agora) {
        pedindo = agora;
        if (!agora) return;
        // A caixa apareceu: quem estava esperando o token agora espera a
        // pessoa, e pessoa demora mais que maquina.
        for (const f of fila) {
          window.clearTimeout(f.prazo);
          f.prazo = window.setTimeout(() => responde(''), ESPERA_DA_PESSOA_MS);
          f.aoPedir();
        }
      },
    });
  }

  return {
    aquece,
    /**
     * O token, ou `''` se ele nao veio. Quem recusa envio sem token e o
     * servidor. `aoPedir` e chamado se a caixa aparecer no meio da espera.
     */
    pede(aoPedir: () => void = () => {}): Promise<string> {
      aquece();
      if (token) return Promise.resolve(token);
      return new Promise((resolve) => {
        const prazo = window.setTimeout(
          () => responde(''),
          pedindo ? ESPERA_DA_PESSOA_MS : ESPERA_MS
        );
        fila.push({ responde: resolve, aoPedir, prazo });
        if (pedindo) aoPedir();
      });
    },
    /** Token vale um envio: depois de cada resposta, outro. */
    renova() {
      token = '';
      desafio?.renova();
    },
  };
}
