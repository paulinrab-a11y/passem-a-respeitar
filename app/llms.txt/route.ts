import { baseDoSite } from '@/lib/base-do-site';
import { DESCRICAO_DO_SITE, NOME_DO_SITE } from '@/lib/cartao-do-link';
import { EP_E_O_LANCAMENTO, LANCAMENTO_EM_FRASE } from '@/lib/ep';
import { CONFIG } from '../_home/config';

/**
 * /llms.txt: o resumo do site em texto puro para assistentes de IA, que o
 * dono liberou de proposito (robots.ts). So o que a pagina ja mostra. A data
 * do lancamento ficou em sigilo ate o pre-save (#269) e e publica desde
 * 26/10/2026: vem de lib/ep.ts, a mesma da home, e e a unica data daqui.
 */
export const dynamic = 'force-static';

export function GET() {
  const base = baseDoSite(process.env.NEXT_PUBLIC_SITE_URL, process.env.VERCEL_URL);
  const url = (caminho: string) => new URL(caminho, base).href;

  const texto = `# ${NOME_DO_SITE}

> ${DESCRICAO_DO_SITE}

Site oficial do EP "Passem a Respeitar", de Santxx e Ch3fe, lancado pelo selo Whynot Visuals.

## Lancamento

- Proximo lancamento: ${LANCAMENTO_EM_FRASE}, em todas as plataformas.
${EP_E_O_LANCAMENTO ? '' : '- A data do EP ainda vai ser anunciada.\n'}- [Pre-save](${CONFIG.links.preSave})

## Artistas e selo

- Santxx: ${CONFIG.links.igSantxx}
- Ch3fe: ${CONFIG.links.igChefe}
- Whynot Visuals (selo): ${CONFIG.links.igLabel}

## Loja

- [Camiseta CBAC](${url('/#merch')}): feita sob encomenda, com frete para todo o Brasil pelos Correios.
- [Termos de compra](${url('/termos')}): quem vende, pagamento, cancelamento, arrependimento e troca.
- [Privacidade](${url('/privacidade')}): que dados o site coleta e como pedir para apagar.
`;

  return new Response(texto, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
