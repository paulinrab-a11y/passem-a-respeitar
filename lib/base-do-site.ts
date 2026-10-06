/**
 * A base absoluta do site para o `<head>` (#215): `metadataBase`, `og:url`,
 * `og:image`.
 *
 * Funcao pura, sem `server-only`, porque e lida no build do layout e testada
 * sozinha. A ordem e a mesma de `urlDoSite`, so que aqui nao ha request:
 *
 *   1. `NEXT_PUBLIC_SITE_URL` — o dominio final. Em producao e o www.
 *   2. `VERCEL_URL` — o endereco do proprio deploy, para o preview.
 *   3. localhost.
 *
 * `VERCEL_PROJECT_PRODUCTION_URL` NAO entra aqui de proposito: e "o dominio
 * de producao mais curto", hoje o apex sem www, que e um redirecionamento
 * (licao do #54). Um `og:url` apontando para redirecionamento faz o WhatsApp
 * e o Instagram mostrarem o endereco errado.
 */
export function baseDoSite(siteUrl: string | undefined, vercelUrl: string | undefined): URL {
  const dito = (siteUrl ?? '').trim();
  if (dito) {
    try {
      const url = new URL(dito);
      if (url.protocol === 'https:' || url.protocol === 'http:') return url;
    } catch {
      // Nao e URL: cai na reserva.
    }
  }
  const deploy = (vercelUrl ?? '').trim();
  if (deploy) return new URL(`https://${deploy}`);
  return new URL('http://localhost:3000');
}
