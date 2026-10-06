import Image from 'next/image';
import { vitrine } from '@/lib/loja/catalogo';
import { precoNaFicha } from '@/lib/loja/precos';
import BarraConta from './_home/BarraConta';
import { CONFIG } from './_home/config';
import FreteNaFicha from './_home/FreteNaFicha';
import Galeria from './_home/Galeria';
import HomeRuntime from './_home/HomeRuntime';
import GuiaDeTamanhos from './_ui/GuiaDeTamanhos';

// A CSP do proxy.ts carrega um nonce novo a cada request, e o Next so
// carimba esse nonce nos proprios scripts quando a rota e renderizada por
// request. Estatico nao funciona: o HTML sairia do build sem nonce e a CSP
// bloquearia todo o JavaScript da pagina.
export const dynamic = 'force-dynamic';

// Markup portado de src/index.html sem alteracao de conteudo, cor, fonte ou
// espacamento. Renderizado no servidor; o comportamento (intro VHS, elos,
// three.js, GSAP, loja 3D, beats, convite) e ligado por HomeRuntime no cliente.
export default async function Home() {
  // O preco e o nome vem do banco desde a #99. Antes moravam aqui no JSX, em
  // dois lugares — `#merch` e `#loja` — com a descricao escrita de dois jeitos
  // diferentes. Enquanto foi assim, nao havia preco no servidor para o checkout
  // recalcular.
  const [camiseta] = await vitrine();

  // Catalogo fora do ar nao derruba a home. Mostrar um preco antigo gravado no
  // codigo seria pior do que nao mostrar preco: a pessoa veria um numero que
  // ninguem garante.
  const temMerch = Boolean(camiseta);
  const tamanhoPadrao =
    camiseta?.variacoes.find((v) => v.tamanho === 'M')?.tamanho ??
    camiseta?.variacoes[0]?.tamanho ??
    '';

  return (
    <>
      {/* Decorativos: o fundo em WebGL e o grao de VHS (#59).
          O `aria-hidden` sai dos canvas e vai para um <div> em volta. O
          efeito para o leitor de tela e o mesmo — os dois somem da arvore de
          acessibilidade —, mas o atributo deixa de estar num elemento que o
          navegador trata como capaz de receber foco. Os dois canvas sao de
          posicao fixa, entao o <div> nao ocupa espaco nenhum na pagina. */}
      <div aria-hidden="true">
        <canvas id="gl"></canvas>
        <canvas id="grain" width="160" height="90"></canvas>
      </div>
      <div id="scan" aria-hidden="true"></div>
      <div id="vig" aria-hidden="true"></div>

      <header id="bar">
        <a href="#hero">
          <span className="sr">Passem a Respeitar — início</span>
          {/* Brasao da CBAC (#218), vetorizado em /brasao.svg. Entra como
              mascara para a cor continuar vindo do CSS (--prata), como o "P"
              de antes; um <img> nao deixaria. */}
          <span className="logo" aria-hidden="true"></span>
        </a>
        <nav className="right" aria-label="Ações">
          <button type="button" id="som" aria-pressed="false">
            <span className="dot"></span>som
          </button>
          <a href="#clipe">clipe</a>
          <a href="#merch">merch</a>
          <a href="#fim">pré-save</a>
          <a href="#fim" id="linkConvite">
            convite
          </a>
          <BarraConta />
        </nav>
      </header>

      <div id="intro" role="dialog" aria-label="Abertura">
        <canvas id="vhs" width="192" height="108"></canvas>
        <div id="rec">
          <i></i>REC
        </div>
        <div id="tc">00:00:00:00</div>
        <div id="tape">SP · 2026 · WHYNOT VISUALS</div>
        <div id="manifesto" aria-live="polite">
          <span className="l">Não são seguidores.</span>
          <span className="l">Não são streams.</span>
          <span className="l">Não é dinheiro.</span>
          <span className="l">Não é status.</span>
          <span className="l">Existe o que construímos quando ninguém estava olhando.</span>
          <span className="l">O respeito vem antes dos números.</span>
          <span className="l fim">Passem a respeitar.</span>
        </div>
        <button type="button" id="ligar">
          ligar o som
        </button>
        <button type="button" id="skip">
          pular
        </button>
      </div>

      <main>
        <section id="hero">
          {/* O logo e a unica imagem acima da dobra, e a unica com `priority`
              (#47). Antes o script legado a injetava depois de carregar
              three.js e GSAP: o titulo aparecia como texto e trocava por
              imagem segundos depois. Agora ja vem no HTML. */}
          <h1 id="logoHero">
            <Image
              src={CONFIG.logoUrl}
              alt=""
              width={1000}
              height={624}
              sizes="(max-width: 767px) 92vw, 760px"
              priority
              draggable={false}
            />
            <span>Passem a respeitar</span>
          </h1>
          <div className="desce" aria-hidden="true">
            puxa a corrente
          </div>
        </section>

        <div id="elos"></div>

        <section id="clipe">
          <div className="in">
            <div className="top">
              <h2>Blick</h2>
            </div>
            <div className="player" id="playerBlick">
              clipe em breve
            </div>
          </div>
        </section>

        <section id="fim">
          <p className="frase">
            Não estamos aqui para pedir espaço.<b>Estamos aqui para ocupar.</b>
          </p>
          <div className="acoes">
            {/* biome-ignore lint/a11y/useValidAnchor: placeholder. O script legado reescreve o href em runtime a partir do CONFIG; os destinos reais dependem das Issues #44 (Comprar) e #58 (pre-save e Instagram). */}
            <a className="btn cheio" id="preSave" href="#" target="_blank" rel="noopener">
              Pré-save
            </a>
            <a className="btn" href="#merch">
              Merch
            </a>
          </div>
          <div className="convite" id="convite">
            <label htmlFor="cod">Recebeu o convite?</label>
            <form id="formConvite" autoComplete="off">
              <input
                id="cod"
                name="cod"
                placeholder="código"
                maxLength={16}
                aria-describedby="erroCod"
              />
              <button type="submit">entrar</button>
              {/* Isca da protecao contra bot (#28): fora da tela, do teclado
                  e do leitor de tela. Quem preenche e script. */}
              <div className="isca" aria-hidden="true">
                <label>
                  Site
                  <input type="text" name="website" tabIndex={-1} autoComplete="off" />
                </label>
              </div>
            </form>
            <div className="erro" id="erroCod" aria-live="polite"></div>
            {/* O widget da Cloudflare so aparece aqui se precisar que a pessoa
                faca alguma coisa. Vazio, nao ocupa lugar. */}
            <div className="desafio-convite" id="desafioConvite"></div>
          </div>
        </section>

        <section id="merch">
          <div className="ficha">
            <h2>Merch</h2>
            <div className="nome">{camiseta?.nome ?? 'Merch'}</div>
            {temMerch ? (
              <div className="preco">
                <small>R$</small>
                {precoNaFicha(camiseta.precoCentavos)}
              </div>
            ) : null}
            <p className="desc">
              {camiseta?.descricao ?? 'Indisponível no momento. Volte daqui a pouco.'}
            </p>
            <fieldset
              className="tam"
              id="tamanhos"
              data-padrao={tamanhoPadrao}
              data-slug={camiseta?.slug ?? ''}
            >
              <legend className="sr">Tamanho</legend>
              {camiseta?.variacoes.map((v) => (
                <button
                  key={v.tamanho}
                  type="button"
                  data-t={v.tamanho ?? ''}
                  className={v.tamanho === tamanhoPadrao ? 'on' : undefined}
                  aria-pressed={v.tamanho === tamanhoPadrao}
                >
                  {v.tamanho}
                </button>
              ))}
            </fieldset>
            {/* O guia (#206), logo abaixo dos tamanhos: e na hora de escolher
                que a duvida aparece. */}
            {camiseta?.guia ? (
              <GuiaDeTamanhos linhas={camiseta.guia} produto={camiseta.nome} />
            ) : null}
            <div className="acoes">
              {/* biome-ignore lint/a11y/useValidAnchor: placeholder. O script legado reescreve o href em runtime a partir do CONFIG; os destinos reais dependem das Issues #44 (Comprar) e #58 (pre-save e Instagram). */}
              <a className="btn cheio" id="comprar" href="#" target="_blank" rel="noopener">
                Comprar
              </a>
            </div>
            <p className="aviso">
              Feita sob encomenda. Entrega em pelo menos 30 dias, para todo o Brasil.
            </p>
            {/* O frete antes do login (#205). Mesma cotacao do checkout. */}
            {camiseta ? <FreteNaFicha slug={camiseta.slug} tamanho={tamanhoPadrao} /> : null}
          </div>
          {/* O `data-alt` existe para o script legado nao precisar repetir o
              nome do produto no alt das fotos — era a terceira copia dele. */}
          {/* As molduras saem do servidor, vazias e na grade final (#46), e
              cada uma ja traz a sua foto como `next/image` preguicosa (#47). */}
          <div className="galeria" id="galeriaMerch">
            <Galeria fotos={CONFIG.merchFotos} alt={camiseta?.nome ?? ''} />
          </div>
        </section>

        <footer className="assina">
          {/* biome-ignore lint/a11y/useValidAnchor: placeholder. O script legado reescreve o href em runtime a partir do CONFIG; os destinos reais dependem das Issues #44 (Comprar) e #58 (pre-save e Instagram). */}
          <a id="igSantxx" href="#" target="_blank" rel="noopener">
            @santxx
          </a>
          {/* biome-ignore lint/a11y/useValidAnchor: placeholder. O script legado reescreve o href em runtime a partir do CONFIG; os destinos reais dependem das Issues #44 (Comprar) e #58 (pre-save e Instagram). */}
          <a id="igChefe" href="#" target="_blank" rel="noopener">
            @ch3fe
          </a>
          {/* biome-ignore lint/a11y/useValidAnchor: placeholder. O script legado reescreve o href em runtime a partir do CONFIG; os destinos reais dependem das Issues #44 (Comprar) e #58 (pre-save e Instagram). */}
          <a id="igLabel" href="#" target="_blank" rel="noopener">
            Whynot Visuals
          </a>
          {/* So CBAC (#187): a camiseta e da marca, nao e colab com o EP. */}
          <span>CBAC</span>
          {/* A politica existe desde a #109. Rodape e onde a pessoa procura. */}
          <a href="/privacidade">privacidade</a>
          {/* Credito do site (#195). Link fixo, fora do CONFIG: nao muda por ambiente. */}
          <p className="assina-credito">
            site feito pela{' '}
            <a href="https://instagram.com/whynotvisuals_" target="_blank" rel="noopener">
              Whynot Visuals
            </a>
          </p>
        </footer>
      </main>

      <div className="tocando" id="tocando" title="pular (N)">
        <span className="eq">
          <i></i>
          <i></i>
          <i></i>
          <i></i>
        </span>
        <span id="tocandoNome"></span>
      </div>

      <div id="loja" role="dialog" aria-modal="true" aria-labelledby="lojaTitulo">
        <button type="button" className="fechar" id="fecharLoja">
          fechar
        </button>
        <div className="in">
          <div className="vitrine" id="vitrine">
            <canvas id="glLoja"></canvas>
            <div className="dica">arrasta pra girar</div>
          </div>
          <div>
            <h3 id="lojaTitulo">{camiseta?.nome ?? 'Merch'}</h3>
            {temMerch ? (
              <div className="preco">
                <small>R$</small>
                {precoNaFicha(camiseta.precoCentavos)}
              </div>
            ) : null}
            {/* A descricao e a MESMA de #merch. Antes eram dois textos dizendo a
                mesma coisa com palavras diferentes; agora ha uma so, no banco. */}
            <p className="desc">
              {camiseta?.descricao ?? 'Indisponível no momento. Volte daqui a pouco.'}
            </p>
            {/* O nome do grupo, para quem ve. Para quem ouve, e a legenda. */}
            <div className="rotulo" aria-hidden="true">
              tamanho
            </div>
            <fieldset
              className="tam"
              id="tamLoja"
              data-padrao={tamanhoPadrao}
              data-slug={camiseta?.slug ?? ''}
            >
              <legend className="sr">Tamanho</legend>
              {camiseta?.variacoes.map((v) => (
                <button
                  key={v.tamanho}
                  type="button"
                  data-t={v.tamanho ?? ''}
                  className={v.tamanho === tamanhoPadrao ? 'on' : undefined}
                  aria-pressed={v.tamanho === tamanhoPadrao}
                >
                  {v.tamanho}
                </button>
              ))}
            </fieldset>
            {camiseta?.guia ? (
              <GuiaDeTamanhos linhas={camiseta.guia} produto={camiseta.nome} />
            ) : null}
            <div className="acoes">
              {/* biome-ignore lint/a11y/useValidAnchor: placeholder. O script legado reescreve o href em runtime a partir do CONFIG; os destinos reais dependem das Issues #44 (Comprar) e #58 (pre-save e Instagram). */}
              <a className="btn cheio" id="comprarLoja" href="#" target="_blank" rel="noopener">
                Comprar
              </a>
            </div>
            <p className="aviso">
              Feita sob encomenda. Entrega em pelo menos 30 dias, para todo o Brasil.
            </p>
            {/* A mesma ficha da secao: o CEP digitado la aparece aqui. */}
            {camiseta ? <FreteNaFicha slug={camiseta.slug} tamanho={tamanhoPadrao} /> : null}
          </div>
        </div>
      </div>

      <div id="sala" role="dialog" aria-modal="true" aria-labelledby="salaTitulo">
        <button type="button" className="fechar" id="fecharSala">
          fechar
        </button>
        <div className="in">
          <h3 id="salaTitulo">Você foi chamado.</h3>
          <p id="salaTexto">
            Antes de todo mundo. O teaser do clipe de Passem a Respeitar entra aqui na data do
            convite. Guarda o código.
          </p>
          <div className="video" id="salaVideo">
            teaser em breve
          </div>
        </div>
      </div>

      {/* Concierge (#191): um chat pequeno, fixo no canto, que fala com
          /api/concierge. Quem sabe do EP e o servidor; aqui so a caixa.
          Fechado por padrao e fora da arvore de acessibilidade ate abrir. */}
      <button
        type="button"
        className="btn concierge-abrir"
        id="abrirConcierge"
        aria-controls="concierge"
        aria-expanded="false"
      >
        concierge
      </button>
      <section
        id="concierge"
        className="concierge"
        role="dialog"
        aria-labelledby="conciergeTitulo"
        hidden
      >
        <div className="concierge-topo">
          <h3 id="conciergeTitulo">Concierge</h3>
          <button type="button" className="concierge-fechar" id="fecharConcierge">
            fechar
          </button>
        </div>
        <div className="concierge-lista" id="conciergeLista" aria-live="polite"></div>
        <div className="concierge-digitando" id="conciergeDigitando" aria-hidden="true">
          <span className="sr">O concierge está escrevendo</span>
          <span className="eq">
            <i></i>
            <i></i>
            <i></i>
          </span>
        </div>
        <div className="concierge-aviso" id="conciergeAviso" aria-live="polite"></div>
        <form id="formConcierge" className="concierge-form" autoComplete="off">
          <label htmlFor="conciergeTexto" className="sr">
            Pergunta para o concierge
          </label>
          <textarea
            id="conciergeTexto"
            name="mensagem"
            rows={2}
            maxLength={500}
            placeholder="pergunta sobre o EP"
          ></textarea>
          {/* Isca da protecao contra bot (#28), igual a do convite. */}
          <div className="isca" aria-hidden="true">
            <label>
              Site
              <input type="text" name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          <div className="desafio-convite" id="desafioConcierge"></div>
          <button type="submit" className="btn cheio" id="enviarConcierge">
            enviar
          </button>
        </form>
      </section>

      <HomeRuntime />
    </>
  );
}
