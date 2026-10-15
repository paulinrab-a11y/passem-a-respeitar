import { baseDoSite } from '@/lib/base-do-site';
import { DESCRICAO_DO_SITE, NOME_DO_SITE } from '@/lib/cartao-do-link';
import { CONFIG } from '../_home/config';

/**
 * /llms.txt: o resumo do site em texto puro para assistentes de IA, que o
 * dono liberou de proposito (robots.ts). So o que a pagina ja mostra, e
 * nenhuma data: a do lancamento fica em sigilo ate o pre-save (#269).
 */
export const dynamic = 'force-static';

export function GET() {
  const base = baseDoSite(process.env.NEXT_PUBLIC_SITE_URL, process.env.VERCEL_URL);
  const url = (caminho: string) => new URL(caminho, base).href;

  const texto = `# ${NOME_DO_SITE}

> ${DESCRICAO_DO_SITE}

Site oficial do EP "Passem a Respeitar", de Santxx e Ch3fe, lancado pelo selo Whynot Visuals.

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
