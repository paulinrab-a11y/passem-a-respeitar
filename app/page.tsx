import HomeRuntime from './_home/HomeRuntime';

// Markup portado de src/index.html sem alteracao de conteudo, cor, fonte ou
// espacamento. Renderizado no servidor; o comportamento (intro VHS, elos,
// three.js, GSAP, loja 3D, beats, convite) e ligado por HomeRuntime no cliente.
export default function Home() {
  return (
    <>
      {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: canvas decorativo (WebGL de fundo e grain VHS), sem tabindex, logo nao focavel. O aria-hidden e proposital para o leitor de tela ignorar. */}
      <canvas id="gl" aria-hidden="true"></canvas>
      {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: idem, textura de grao puramente decorativa. */}
      <canvas id="grain" width="160" height="90" aria-hidden="true"></canvas>
      <div id="scan" aria-hidden="true"></div>
      <div id="vig" aria-hidden="true"></div>

      <header id="bar">
        <a href="#hero">
          <span className="sr">Passem a Respeitar — início</span>
          <svg className="logo" viewBox="0 0 34 34" aria-hidden="true">
            <path d="M17 1.5a15.5 15.5 0 1 0 0 31 15.5 15.5 0 0 0 0-31Zm0 2.6a12.9 12.9 0 1 1 0 25.8 12.9 12.9 0 0 1 0-25.8Z" />
            <path d="M12.4 8.6h7.1c3.9 0 6.2 2.2 6.2 5.6 0 3.5-2.3 5.7-6.2 5.7h-3.6v6.5h-3.5V8.6Zm3.5 3v5.4h3.3c1.8 0 2.9-1 2.9-2.7s-1.1-2.7-2.9-2.7h-3.3Z" />
            <path d="M9.6 24.6 24.4 9.4l1.9 1.9L11.5 26.5z" />
          </svg>
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
        </nav>
      </header>

      <div id="intro" role="dialog" aria-label="Abertura">
        <canvas id="vhs" width="192" height="108"></canvas>
        <div id="rec">
          <i></i>REC
        </div>
        <div id="tc">00:00:00:00</div>
        <div id="tape">SP · 2026 · WHYNOT</div>
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
          <h1 id="logoHero">Passem a respeitar</h1>
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
            </form>
            <div className="erro" id="erroCod" aria-live="polite"></div>
          </div>
        </section>

        <section id="merch">
          <div className="ficha">
            <h2>Merch</h2>
            <div className="nome">Camiseta CBAC x Passem a Respeitar</div>
            <div className="preco">
              <small>R$</small>120
            </div>
            <p className="desc">
              Preta, oversized, estampa branca do brasão CBAC no peito. Edição do EP.
            </p>
            {/* biome-ignore lint/a11y/useSemanticElements: trocar por <fieldset> traz borda, padding e min-width proprios e mexeria no layout do seletor de tamanho. Tratar na Issue #59. */}
            <div className="tam" id="tamanhos" role="group" aria-label="Tamanho">
              <button type="button" data-t="P">
                P
              </button>
              <button type="button" data-t="M" className="on">
                M
              </button>
              <button type="button" data-t="G">
                G
              </button>
              <button type="button" data-t="GG">
                GG
              </button>
            </div>
            <div className="acoes">
              {/* biome-ignore lint/a11y/useValidAnchor: placeholder. O script legado reescreve o href em runtime a partir do CONFIG; os destinos reais dependem das Issues #44 (Comprar) e #58 (pre-save e Instagram). */}
              <a className="btn cheio" id="comprar" href="#" target="_blank" rel="noopener">
                Comprar
              </a>
            </div>
            <p className="aviso">Envio para todo o Brasil.</p>
          </div>
          <div className="galeria" id="galeriaMerch"></div>
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
            WhyNot Records
          </a>
          <span>CBAC x P.A.R</span>
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
            <h3 id="lojaTitulo">Camiseta CBAC x Passem a Respeitar</h3>
            <div className="preco">
              <small>R$</small>120
            </div>
            <p className="desc">Preta, oversized, brasão CBAC em branco no peito. Edição do EP.</p>
            <div className="rotulo">tamanho</div>
            {/* biome-ignore lint/a11y/useSemanticElements: trocar por <fieldset> traz borda, padding e min-width proprios e mexeria no layout do seletor de tamanho. Tratar na Issue #59. */}
            <div className="tam" id="tamLoja" role="group" aria-label="Tamanho">
              <button type="button" data-t="P">
                P
              </button>
              <button type="button" data-t="M" className="on">
                M
              </button>
              <button type="button" data-t="G">
                G
              </button>
              <button type="button" data-t="GG">
                GG
              </button>
            </div>
            <div className="acoes">
              {/* biome-ignore lint/a11y/useValidAnchor: placeholder. O script legado reescreve o href em runtime a partir do CONFIG; os destinos reais dependem das Issues #44 (Comprar) e #58 (pre-save e Instagram). */}
              <a className="btn cheio" id="comprarLoja" href="#" target="_blank" rel="noopener">
                Comprar
              </a>
            </div>
            <p className="aviso">Envio para todo o Brasil.</p>
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

      <HomeRuntime />
    </>
  );
}
