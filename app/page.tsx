import Image from 'next/image';
import { baseDoSite } from '@/lib/base-do-site';
import { DESCRICAO_DO_SITE, NOME_DO_SITE } from '@/lib/cartao-do-link';
import { grafoDoSite } from '@/lib/dados-estruturados';
import { DATA_DE_LANCAMENTO, LANCAMENTO_CURTO } from '@/lib/ep';
import { vitrine } from '@/lib/loja/catalogo';
import { PRAZO_DE_PRODUCAO_DIAS } from '@/lib/loja/prazo';
import { precoNaFicha } from '@/lib/loja/precos';
import Bandeira from './_home/Bandeira';
import BarraConta, { LugarDoMenuConta } from './_home/BarraConta';
import { CONFIG } from './_home/config';
import FreteNaFicha from './_home/FreteNaFicha';
import Galeria from './_home/Galeria';
import HomeRuntime from './_home/HomeRuntime';
import QuemSao from './_home/QuemSao';
import GuiaDeTamanhos from './_ui/GuiaDeTamanhos';
import JsonLd from './_ui/JsonLd';

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
  // Nenhum tamanho vem marcado (#347): era M para todo mundo, e quem nao
  // olhava os botoes comprava M sem ter escolhido. O frete da ficha nao
  // depende do tamanho (peso e caixa sao os mesmos), entao a cotacao usa o
  // primeiro do catalogo so como referencia.
  const tamanhoDoFrete = camiseta?.variacoes[0]?.tamanho ?? null;

  // JSON-LD (#322): selo, site e a camiseta com o preco do mesmo catalogo da
  // ficha. Os artistas e o EP, ligados por @id, desde a #275.
  // O genero so vai ao grafo se a pagina o mostrar (#386): o paragrafo
  // "quem sao" diz trap. Sem esse texto, o grafo nao afirma genero nenhum.
  const generos = /\btrap\b/i.test(CONFIG.quemSao) ? ['Trap', 'Rap'] : undefined;
  const grafo = grafoDoSite({
    base: baseDoSite(process.env.NEXT_PUBLIC_SITE_URL, process.env.VERCEL_URL),
    nomeDoSite: NOME_DO_SITE,
    descricaoDoSite: DESCRICAO_DO_SITE,
    instagramDoSelo: CONFIG.links.igLabel,
    artistas: [
      { ancora: 'santxx', nome: 'Santxx', perfis: [CONFIG.links.igSantxx], generos },
      { ancora: 'ch3fe', nome: 'Ch3fe', perfis: [CONFIG.links.igChefe], generos },
    ],
    nomeDoEp: 'Passem a Respeitar',
    camiseta: camiseta
      ? {
          slug: camiseta.slug,
          nome: camiseta.nome,
          descricao: camiseta.descricao,
          precosCentavos: camiseta.variacoes.map((v) => v.precoCentavos),
        }
      : null,
    fotosDaCamiseta: CONFIG.merchFotos,
  });

  return (
    <>
      <JsonLd dado={grafo} />
      {/* Decorativos: o fundo em WebGL e o grao de VHS (#59).
          O `aria-hidden` sai dos canvas e vai para um <div> em volta. O
          efeito para o leitor de tela e o mesmo — os dois somem da arvore de
          acessibilidade —, mas o atributo deixa de estar num elemento que o
          navegador trata como capaz de receber foco. Os dois canvas sao de
          posicao fixa, entao o <div> nao ocupa espaco nenhum na pagina. */}
      <div aria-hidden="true">
        <canvas id="gl"></canvas>
        {/* O teaser do Blick no canto VHS, por baixo do grao e na mesma caixa
            de 160x90. Nasce sem src: quem escreve e app/_home/clipe-no-canto.ts,
            com a intro fechada. Mudo, e fora do teclado e do leitor de tela. */}
        <video
          id="canto"
          width={160}
          height={90}
          muted
          loop
          playsInline
          preload="none"
          disablePictureInPicture
          disableRemotePlayback
        ></video>
        <canvas id="grain" width="160" height="90"></canvas>
      </div>
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
          {/* Abaixo de 375 px o clipe sai da barra (#376): os sete itens nao
              cabem, e o "entrar" saia pela borda. A secao continua no rolar. */}
          <a href="#clipe" className="bar-clipe">
            clipe
          </a>
          <a href="#merch">merch</a>
          <a href="#fim">pré-save</a>
          <a href="#fim" id="linkConvite">
            convite
          </a>
          <BarraConta />
        </nav>
      </header>
      {/* O painel da conta abre aqui, fora de #bar e logo depois dele na
          ordem do Tab: ver BarraConta. */}
      <LugarDoMenuConta />

      {/* Modal de verdade (#270): enquanto ela cobre a tela, o resto e inerte
          (ver abertura.ts), e o leitor de tela para de ler por baixo. */}
      <div id="intro" role="dialog" aria-modal="true" aria-label="Abertura">
        <canvas id="vhs" width="192" height="108"></canvas>
        <div id="rec">
          <i></i>REC
        </div>
        <div id="tc">00:00:00:00</div>
        <div id="tape">SP · 2026 · WHYNOT VISUALS</div>
        {/* `.nitida` e a camada que a intro acende por cima de uma copia
            borrada, montada no cliente (#286, ver nevoaDaLinha em
            abertura.ts). O texto fica uma vez so no HTML. */}
        <div id="manifesto" aria-live="polite">
          <span className="l">
            <span className="nitida">Não são seguidores.</span>
          </span>
          <span className="l">
            <span className="nitida">Não são streams.</span>
          </span>
          <span className="l">
            <span className="nitida">Não é dinheiro.</span>
          </span>
          <span className="l">
            <span className="nitida">Não é status.</span>
          </span>
          <span className="l">
            <span className="nitida">Existe o que construímos quando ninguém estava olhando.</span>
          </span>
          <span className="l">
            <span className="nitida">O respeito vem antes dos números.</span>
          </span>
          {/* O logo do fim sai do servidor com largura e altura, como o do
              hero (#344). O script o injetava sem medida, e a linha mudava de
              tamanho quando a imagem chegava. Sem `priority`: so aparece no
              fim da abertura. */}
          <span className="l fim">
            <span className="nitida">
              {CONFIG.logoUrl ? (
                <>
                  <Image
                    src={CONFIG.logoUrl}
                    alt=""
                    width={1000}
                    height={624}
                    sizes="(max-width: 767px) 70vw, 520px"
                    draggable={false}
                  />
                  <span>Passem a respeitar</span>
                </>
              ) : (
                'Passem a respeitar.'
              )}
            </span>
          </span>
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
              imagem segundos depois. Agora ja vem no HTML, e na frente da
              fila de rede (#377): `priority` sozinho nao poe o fetchpriority
              na tag. */}
          <h1 id="logoHero">
            <Image
              src={CONFIG.logoUrl}
              alt=""
              width={1000}
              height={624}
              sizes="(max-width: 767px) 92vw, 760px"
              priority
              fetchPriority="high"
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
            {/* O script monta o <video> quando a secao chega perto (#47, #75).
                Sem video configurado, a caixa diz que ele vem. */}
            <div className="player" id="playerBlick">
              {CONFIG.clipe.blick ? 'teaser do Blick' : 'clipe em breve'}
            </div>
          </div>
        </section>

        <section id="fim">
          <Bandeira />
          <p className="frase">
            Não estamos aqui para pedir espaço.<b>Estamos aqui para ocupar.</b>
          </p>
          {/* A data e publica desde o pre-save (#269) e mora em lib/ep.ts. */}
          <p className="lancamento">
            <time dateTime={DATA_DE_LANCAMENTO}>{LANCAMENTO_CURTO}</time> — em todas as plataformas
          </p>
          <div className="acoes">
            {/* O link sai do servidor: funciona antes do script e sem ele. O
                script legado so desliga o botao se o CONFIG ficar sem link. */}
            <a
              className="btn cheio"
              id="preSave"
              href={CONFIG.links.preSave}
              target="_blank"
              rel="noopener"
            >
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
              {/* Nome proprio (#376): a home tem dois "entrar" — este e o da
                  conta, na barra. O texto visivel continua o mesmo, e o nome
                  comeca por ele. */}
              <button type="submit" aria-label="Entrar com o código do convite">
                entrar
              </button>
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
            <fieldset className="tam" id="tamanhos" data-slug={camiseta?.slug ?? ''}>
              <legend className="sr">Tamanho</legend>
              {camiseta?.variacoes.map((v) => (
                <button key={v.tamanho} type="button" data-t={v.tamanho ?? ''} aria-pressed={false}>
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
              {/* Botao, e nao link (#376): ele so abre a loja, nao leva a lugar
                  nenhum. Quem leva ao checkout e o Comprar de dentro da loja. */}
              <button type="button" className="btn cheio" id="comprar">
                Comprar
              </button>
            </div>
            <p className="aviso">
              {`Feita sob encomenda. Entrega em pelo menos ${PRAZO_DE_PRODUCAO_DIAS} dias, para todo o Brasil.`}
            </p>
            {/* O frete antes do login (#205). Mesma cotacao do checkout. */}
            {camiseta ? <FreteNaFicha slug={camiseta.slug} tamanho={tamanhoDoFrete} /> : null}
          </div>
          {/* O `data-alt` existe para o script legado nao precisar repetir o
              nome do produto no alt das fotos — era a terceira copia dele. */}
          {/* As molduras saem do servidor, vazias e na grade final (#46), e
              cada uma ja traz a sua foto como `next/image` preguicosa (#47). */}
          <div className="galeria" id="galeriaMerch">
            <Galeria fotos={CONFIG.merchFotos} alt={camiseta?.nome ?? ''} />
          </div>
        </section>

        <QuemSao texto={CONFIG.quemSao} />

        <footer className="assina">
          {/* Os perfis saem prontos do servidor (#275): robo de busca e de IA
              ve o vinculo site -> perfis sem rodar JavaScript. `me` diz que o
              perfil e de quem o site fala. */}
          {/* O nome antes do arroba (#386): quem busca "Santxx" ou "Ch3fe"
              acha o nome no texto, e nao so o perfil. */}
          <a id="igSantxx" href={CONFIG.links.igSantxx} target="_blank" rel="me noopener">
            Santxx · @ogsantxx
          </a>
          <a id="igChefe" href={CONFIG.links.igChefe} target="_blank" rel="me noopener">
            Ch3fe · @ch3fe3k
          </a>
          <a id="igLabel" href={CONFIG.links.igLabel} target="_blank" rel="me noopener">
            Whynot Visuals
          </a>
          {/* So CBAC (#187): a camiseta e da marca, nao e colab com o EP. */}
          <span>CBAC</span>
          {/* A politica existe desde a #109. Rodape e onde a pessoa procura. */}
          <a href="/privacidade">privacidade</a>
          {/* Os termos de compra (#276), ao lado: quem procura como trocar ou
              desistir procura no mesmo lugar que a privacidade. */}
          <a href="/termos">termos de compra</a>
          {/* Credito do site (#195). Link fixo, fora do CONFIG: nao muda por ambiente. */}
          <p className="assina-credito">
            site feito pela{' '}
            <a href="https://instagram.com/whynotvisuals_" target="_blank" rel="noopener">
              Whynot Visuals
            </a>
          </p>
        </footer>
      </main>

      {/* Botao (#280): teclado e leitor de tela tambem pulam o beat. Nasce
          apagado e, por isso, fora do Tab e do leitor de tela; o script o
          acende quando o som liga (app/_home/teclado.ts). O nome comeca pelo
          beat, que e o texto visivel. */}
      <button
        type="button"
        className="tocando"
        id="tocando"
        title="pular (N)"
        aria-keyshortcuts="N"
        tabIndex={-1}
        aria-hidden="true"
      >
        <span className="eq">
          <i></i>
          <i></i>
          <i></i>
          <i></i>
        </span>
        <span id="tocandoNome"></span>
        <span className="sr">, pular para o próximo beat</span>
      </button>

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
            <fieldset className="tam" id="tamLoja" data-slug={camiseta?.slug ?? ''}>
              <legend className="sr">Tamanho</legend>
              {camiseta?.variacoes.map((v) => (
                <button key={v.tamanho} type="button" data-t={v.tamanho ?? ''} aria-pressed={false}>
                  {v.tamanho}
                </button>
              ))}
            </fieldset>
            {camiseta?.guia ? (
              <GuiaDeTamanhos linhas={camiseta.guia} produto={camiseta.nome} />
            ) : null}
            <div className="acoes">
              {/* biome-ignore lint/a11y/useValidAnchor: nasce desabilitado, sem `href` (#347): o script legado escreve o destino, /checkout com o produto e o tamanho escolhido (#106), so depois da escolha. Sem `target`: o checkout abre na mesma aba e a loja sai animada (#301). Os dois rotulos na mesma celula: a largura nao muda na troca. */}
              <a className="btn cheio off" id="comprarLoja" role="link" aria-disabled="true">
                <span className="rotulo-acao" data-ativo="">
                  <span>Comprar</span>
                  <span>Escolha o tamanho</span>
                </span>
              </a>
            </div>
            <p className="aviso">
              {`Feita sob encomenda. Entrega em pelo menos ${PRAZO_DE_PRODUCAO_DIAS} dias, para todo o Brasil.`}
            </p>
            {/* A mesma ficha da secao: o CEP digitado la aparece aqui. */}
            {camiseta ? <FreteNaFicha slug={camiseta.slug} tamanho={tamanhoDoFrete} /> : null}
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
        aria-describedby="conciergeNota"
        hidden
      >
        <div className="concierge-topo">
          <h3 id="conciergeTitulo">Concierge</h3>
          <button type="button" className="concierge-fechar" id="fecharConcierge">
            fechar
          </button>
        </div>
        {/* #278: a resposta e de um modelo, e pode errar. O numero que vale e o
            do checkout, e quem le o chat precisa saber disso antes do print. */}
        <p className="concierge-nota" id="conciergeNota">
          O concierge é automático e pode errar. Preço, frete e prazo valem os do checkout.
        </p>
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
