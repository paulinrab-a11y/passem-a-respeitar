/**
 * "Quem sao Santxx e Ch3fe" (#275), no HTML do servidor: robo de busca e de
 * IA le o texto sem rodar JavaScript.
 *
 * O texto mora em `CONFIG.quemSao` e esta vazio de proposito: quem escreve
 * sobre os artistas sao eles e o dono, nao o codigo. Vazio, a secao nao existe
 * na pagina (nem titulo solto, nem espaco reservado).
 */
export default function QuemSao({ texto }: { texto: string }) {
  const limpo = texto.trim();
  if (!limpo) return null;

  return (
    <section id="quem-sao" aria-labelledby="quemSaoTitulo">
      <div className="in">
        <h2 id="quemSaoTitulo">Quem são Santxx e Ch3fe</h2>
        <p>{limpo}</p>
      </div>
    </section>
  );
}
