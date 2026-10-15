import { serializaJsonLd } from '@/lib/dados-estruturados';

/**
 * Bloco JSON-LD (#322), o jeito que o Next documenta para dados estruturados.
 *
 * Sem nonce: `application/ld+json` e bloco de dado, o navegador nao executa,
 * e a CSP nao se aplica a ele. O `<` sai escapado por `serializaJsonLd`, entao
 * texto vindo do banco nao fecha a tag.
 */
export default function JsonLd({ dado }: { dado: unknown }) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON do proprio servidor, com `<` escapado; e o unico jeito de por JSON-LD no HTML sem o React escapar as aspas.
      dangerouslySetInnerHTML={{ __html: serializaJsonLd(dado) }}
    />
  );
}
