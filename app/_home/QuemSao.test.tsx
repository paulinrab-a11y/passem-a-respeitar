import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import QuemSao from './QuemSao';

describe('QuemSao (#275)', () => {
  it('sem texto, nao renderiza nada', () => {
    expect(renderToStaticMarkup(<QuemSao texto="" />)).toBe('');
    expect(renderToStaticMarkup(<QuemSao texto={'  \n '} />)).toBe('');
  });

  it('com texto, sai como secao com titulo e paragrafo', () => {
    const html = renderToStaticMarkup(<QuemSao texto=" Dois artistas. " />);
    expect(html).toContain('<section id="quem-sao" aria-labelledby="quemSaoTitulo">');
    expect(html).toContain('<h2 id="quemSaoTitulo">Quem são Santxx e Ch3fe</h2>');
    expect(html).toContain('<p>Dois artistas.</p>');
  });

  // O texto e do dono (#386): o codigo nao publica biografia por conta. Este
  // teste trava o paragrafo aprovado; mudar o texto e decisao dele.
  it('o texto do CONFIG e o aprovado pelo dono, sem data', () => {
    expect(CONFIG.quemSao).toBe(
      'Santxx e Ch3fe são dois nomes do trap de São Paulo. Passem a Respeitar é o EP que os dois assinam juntos, pela Whynot Visuals.'
    );
    expect(CONFIG.quemSao).not.toMatch(/\b(19|20)\d{2}\b/);
  });
});
