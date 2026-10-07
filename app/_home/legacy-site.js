// Script original do site, extraido verbatim de src/index.html (linhas 466-1185).
// Nao reformatar: manter identico facilita auditar a migracao contra o deploy antigo.
// Depende dos globais THREE, gsap e ScrollTrigger, atribuidos por HomeRuntime.tsx.
// @ts-nocheck

// Fechar a abertura e um contrato com o HomeRuntime (#238): ele fecha quando
// este script nao chega, a intro fecha quando chega. Os dois pelo mesmo lugar.
import { fechaAbertura } from './abertura';
// E o navegador tem WebGL? A resposta decide se a cena que lancou e um
// aparelho sem 3D (esperado) ou um bug que o Sentry precisa saber.
import { temWebGL } from './webgl';

let booted = false;

export default function initSite(CONFIG, extras) {
// Issue #28: o que a home recebe de fora do script. A protecao contra bot do
// convite (`null` quando nao ha chave configurada) e, desde a #238, se a
// pessoa clicou em 'pular' enquanto este script ainda baixava e quem leva ao
// Sentry um erro da cena 3D — este script nao importa o Sentry, como nao
// importa o Turnstile.
const humano = (extras && extras.humano) || null;
const pulouAntes = !!(extras && extras.pulou);
const reporta = (extras && typeof extras.reporta === 'function') ? extras.reporta : null;
  if (booted) return;
  booted = true;


const FRASES = [
  { t:'Não precisamos de números\npara provar quem somos.', elo:-0.4, lado: 1, prof: 0.4, esc:1.0 },
  { t:'Existe uma história\nantes de tudo isso.',            elo: 0.35, lado:-1, prof:-0.8, esc:0.85 },
  { t:'Existe o que enfrentamos\nquando ninguém acreditava.', elo: 0.9,  lado: 1, prof: 0.2, esc:0.8 },
  { t:'Existe tudo aquilo\nque nos trouxe até aqui.',         elo: 1.45, lado:-1, prof:-1.1, esc:0.9 },
  { t:'Nós sabemos\no nosso valor.',                          elo: 2.0,  lado: 1, prof: 0.5, esc:1.1 },
  { t:'Sabemos de onde viemos.',                                elo: 2.5,  lado:-1, prof:-0.6, esc:0.8 },
  { t:'Sabemos o que construímos.',                             elo: 2.95, lado: 1, prof:-1.3, esc:0.8 },
  { t:'E sabemos onde\nqueremos chegar.',                     elo: 3.45, lado:-1, prof: 0.3, esc:1.0 },
  { t:'Não estamos aqui\npara pedir espaço.',                 elo: 3.95, lado: 1, prof:-0.9, esc:0.9 },
  { t:'Estamos aqui\npara ocupar.',                           elo: 4.4,  lado:-1, prof: 0.6, esc:1.15 },
  { t:'Respeito não deveria\ndepender de números.',           elo: 4.95, lado: 1, prof:-0.7, esc:0.85 },
  { t:'E se ainda não entenderam,\ntalvez esteja na hora\nde deixar claro:', elo: 5.5, lado:-1, prof: 0.2, esc:0.9 },
];

const TRACKS = [
  { n:'01', titulo:'O que é Passem a Respeitar',
    texto:'O projeto Passem a Respeitar, ou simplesmente P.A.R., parte de uma ideia simples: reconhecer o próprio valor e ocupar o espaço que existe para você.',
    rough:0.18 },
  { n:'02', titulo:'Mais do que um nome',
    texto:'P.A.R. representa uma postura. É sobre entender de onde viemos, reconhecer tudo o que foi construído até aqui e seguir avançando sem permitir que alguém determine o tamanho do nosso espaço.',
    rough:0.32 },
  { n:'03', titulo:'Música, imagem e atitude',
    texto:'O projeto nasce da vontade de transformar essa ideia em música, imagem e atitude. Não como uma resposta para alguém específico, mas como uma forma de se posicionar diante de tudo aquilo que tenta limitar, diminuir ou definir quem você deve ser.',
    rough:0.55 },
  { n:'04', palavra:'Presença',    rough:0.42 },
  { n:'05', palavra:'Identidade',  rough:0.12 },
  { n:'06', palavra:'Trajetória',  rough:0.60 },
  { n:'07', palavra:'Resistência', rough:0.72 },
];

const reduzMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = matchMedia('(max-width: 720px)').matches || /Mobi|Android/i.test(navigator.userAgent);
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

// Issue #58: sem link de pre-save, o botao virava um call to action morto —
// o principal da pagina final, e nao fazia nada ao ser clicado. Agora ele
// assume o mesmo tratamento que o campo de convite ja usava: "em breve",
// desabilitado, em vez de prometer uma acao que nao acontece.
(function preSave(){
  const a = $('#preSave');
  const link = CONFIG.links.preSave;
  if (!link || link === '#'){
    a.removeAttribute('href');
    a.removeAttribute('target');
    a.classList.add('off');
    a.setAttribute('aria-disabled', 'true');
    a.textContent = 'Pré-save em breve';
    return;
  }
  a.href = link;
})();
$('#igSantxx').href = CONFIG.links.igSantxx;
$('#igChefe').href = CONFIG.links.igChefe;
$('#igLabel').href = CONFIG.links.igLabel;

if (CONFIG.logoUrl){
  const logo = `<img src="${CONFIG.logoUrl}" alt="" draggable="false"><span>Passem a respeitar</span>`;
  // O logo do hero ja vem do servidor, como next/image com priority (#47).
  $('#manifesto .fim').innerHTML = logo;
}
const driveAudio = id => /^(https?:|\/)/.test(id) ? [id] : [
  `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`,
  `https://drive.google.com/uc?export=download&id=${id}`,
  `https://docs.google.com/uc?export=open&id=${id}`,
];
const drive = (id, w=1600) => /^(https?:|\/)/.test(id) ? id : `https://lh3.googleusercontent.com/d/${id}=w${w}`;

(function merch(){
  // O botao vai junto: e para ele que o foco volta quando a loja fecha (#49).
  $('#comprar').addEventListener('click', e=>{ e.preventDefault(); Loja.abre(tam, e.currentTarget); });
  // A galeria e montada pelo componente Galeria, com next/image (#47).
  let tam = $('#tamanhos').dataset.padrao || '';
  const link = ()=>{ $('#comprar').href = CONFIG.links.merch === '#' ? '#' : CONFIG.links.merch + (CONFIG.links.merch.includes('?')?'&':'?') + 'tam=' + tam; };
  $('#tamanhos').addEventListener('click', e=>{
    const b = e.target.closest('button'); if(!b) return;
    // `aria-pressed` anda junto com a classe (#59): a classe pinta, o atributo diz.
    $$('#tamanhos button').forEach(x=>{ x.classList.toggle('on', x===b); x.setAttribute('aria-pressed', String(x===b)); }); tam = b.dataset.t; link(); Som.tick();
  });
  link();
})();

if (CONFIG.clipe.blick){
  // Sob demanda (#47): o player so e montado quando a secao esta a menos de
  // uma tela de distancia. Quem nao desce ate la nao baixa o video.
  const montaClipe = ()=>{
    const u = CONFIG.clipe.blick;
    $('#playerBlick').innerHTML = /\.(mp4|webm)(\?|$)/i.test(u)
      ? `<video src="${u}" controls playsinline preload="metadata"></video>`
      : `<iframe src="${u}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen title="Blick — clipe"></iframe>`;
    // O player brilha ate o video responder (#46). A caixa ja tem a proporcao
    // final, entao nada se move quando ele chega.
    const player = $('#playerBlick'), midia = player.firstElementChild;
    player.classList.add('carregando');
    const chegou = ()=> player.classList.remove('carregando');
    ['load','loadeddata','error'].forEach(ev=> midia.addEventListener(ev, chegou, {once:true}));
  };
  if (!('IntersectionObserver' in window)) montaClipe();
  else {
    const vigiaClipe = new IntersectionObserver(es=>{
      if (!es.some(e=>e.isIntersecting)) return;
      vigiaClipe.disconnect(); montaClipe();
    }, { rootMargin:'100% 0px' });
    vigiaClipe.observe($('#clipe'));
  }
}

// Entrada de secao (#48): fade e deslocamento curto, uma vez, quando a secao
// cruza a viewport. So nas secoes que NAO sao momento de marca — elos, hero e
// intro tem o tratamento deles. A classe e posta aqui, e nao no HTML: se este
// script nao rodar, nada fica invisivel.
(function entradas(){
  const alvos = ['#clipe .in', '#merch .ficha', '#galeriaMerch', '#fim .frase', '#fim .acoes', '#fim .convite']
    .map(s=>$(s)).filter(Boolean);
  alvos.forEach(el=> el.classList.add('entra'));
  const mostra = el=> el.classList.add('vis');
  if (!('IntersectionObserver' in window)){ alvos.forEach(mostra); return; }
  const vigia = new IntersectionObserver(es=>{
    es.forEach(en=>{ if (!en.isIntersecting) return; vigia.unobserve(en.target); mostra(en.target); });
  }, { rootMargin:'0px 0px -8% 0px' });
  alvos.forEach(el=> vigia.observe(el));
})();

// Convite a rolar (#156): o loop do hero para na primeira rolagem, e voltar ao
// topo nao religa. A troca espera o fim do ciclo em andamento — ali a linha esta
// invisivel, e parar no meio seria um corte. Com movimento reduzido o loop nem
// existe, o evento nunca chega e nada muda.
//
// So conta rolagem que saiu do topo: o navegador dispara `scroll` ao restaurar a
// posicao e a intro mexe na pagina, e nenhum dos dois e a pessoa rolando.
(function convite(){
  const desce = $('#hero .desce');
  if (!desce) return;
  const aoRolar = ()=>{
    if (scrollY < 24) return;
    removeEventListener('scroll', aoRolar);
    desce.addEventListener('animationiteration', ()=> desce.classList.add('rolou'), { once:true });
  };
  addEventListener('scroll', aoRolar, { passive:true });
})();

(function montaElos(){
  const wrap = $('#elos');
  TRACKS.forEach((t,i)=>{
    const s = document.createElement('section');
    s.className = 'elo' + (t.palavra ? ' so-palavra' : '');
    s.id = 'elo-' + (i+1);
    s.dataset.i = i;
    s.innerHTML = t.palavra
      ? `<div class="box"><div class="n" aria-hidden="true">${t.n}</div><h2 class="palavra">${t.palavra}</h2></div>`
      : `<div class="box"><div class="n" aria-hidden="true">${t.n}</div><h2>${t.titulo}</h2><p class="texto">${t.texto}</p></div>`;
    wrap.appendChild(s);
  });
})();

const Som = (()=>{
  let ctx, master, sub, subGain, hiss, hissGain, ligado = false, pronto = false;
  const btn = $('#som');
  function init(){
    if (pronto) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = 43;
    const sub2 = ctx.createOscillator(); sub2.type = 'sine'; sub2.frequency.value = 43.6;
    subGain = ctx.createGain(); subGain.gain.value = 0.25;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 90;
    sub.connect(subGain); sub2.connect(subGain); subGain.connect(lp); lp.connect(master);
    sub.start(); sub2.start();
    const buf = ruido(2);
    hiss = ctx.createBufferSource(); hiss.buffer = buf; hiss.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 6000; bp.Q.value = 0.6;
    hissGain = ctx.createGain(); hissGain.gain.value = 0.012;
    hiss.connect(bp); bp.connect(hissGain); hissGain.connect(master);
    hiss.start();
    pronto = true;
  }
  function ruido(seg){
    const b = ctx.createBuffer(1, ctx.sampleRate*seg, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i=0;i<d.length;i++) d[i] = Math.random()*2-1;
    return b;
  }
  const beats = (CONFIG.beats || []).filter(b=>b.url);
  const temBeats = beats.length > 0;
  let player = null, ordem = [], idx = 0, fadeTimer = null;
  const pill = $('#tocando'), pillNome = $('#tocandoNome');
  function embaralha(){ ordem = beats.map((_,i)=>i).sort(()=>Math.random()-.5); idx = 0; }
  function fade(alvo, ms, fim){
    clearInterval(fadeTimer);
    const ini = player.volume, t0 = performance.now();
    fadeTimer = setInterval(()=>{
      const k = Math.min(1, (performance.now()-t0)/ms);
      player.volume = ini + (alvo-ini)*k;
      if (k>=1){ clearInterval(fadeTimer); fim && fim(); }
    }, 40);
  }
  function tocaBeat(){
    if (!ordem.length) embaralha();
    const b = beats[ordem[idx % ordem.length]];
    if (!player){
      player = new Audio(); player.preload = 'auto';
      player.addEventListener('ended', ()=>{ idx++; if (idx >= ordem.length) embaralha(); tocaBeat(); });
      player.addEventListener('error', ()=>{
        if (player._fontes && player._fontes.length){ player.src = player._fontes.shift(); player.play().then(()=> fade(0.7,1200)).catch(()=>{}); return; }
        console.warn('beat não carregou:', b.nome);
        idx++; if (idx < ordem.length*2) tocaBeat();
      });
    }
    player._fontes = driveAudio(b.url);
    player.src = player._fontes.shift(); player.volume = 0;
    player.play().then(()=> fade(0.7, 1200)).catch(err=> console.warn('play:', err.message));
    pillNome.textContent = b.nome; pill.classList.add('on');
  }
  function liga(){
    init();
    if (ctx.state === 'suspended') ctx.resume();
    ligado = true;
    if (temBeats){
      subGain.gain.value = 0; hissGain.gain.value = 0;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.5);
      if (player && player.src && player.paused && player.currentTime > 0){ player.play().then(()=> fade(0.7, 800)).catch(()=>{}); pill.classList.add('on'); }
      else tocaBeat();
    } else {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.linearRampToValueAtTime(0.8, ctx.currentTime + 0.8);
    }
    btn.classList.add('on'); btn.setAttribute('aria-pressed','true');
  }
  function desliga(){
    if (!pronto) return;
    ligado = false;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
    if (player) fade(0, 500, ()=> player.pause());
    pill.classList.remove('on');
    btn.classList.remove('on'); btn.setAttribute('aria-pressed','false');
  }
  function proximo(){ if (!temBeats || !ligado) return; idx++; if (idx >= ordem.length) embaralha(); fade(0, 400, tocaBeat); }
  document.addEventListener('keydown', e=>{ if (e.key === 'n' || e.key === 'N') proximo(); });
  function corrente(forca=1){
    if (!ligado) return;
    const n = 4 + Math.floor(Math.random()*4);
    for (let k=0;k<n;k++){
      const t = ctx.currentTime + k*0.045 + Math.random()*0.02;
      const src = ctx.createBufferSource(); src.buffer = ruido(0.15);
      const bp = ctx.createBiquadFilter(); bp.type='bandpass';
      bp.frequency.value = 1800 + Math.random()*2600; bp.Q.value = 12;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.35*forca*(1-k/n), t+0.005);
      g.gain.exponentialRampToValueAtTime(0.001, t+0.12);
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t); src.stop(t+0.15);
    }
  }
  function tick(){
    if (!ligado || temBeats) return;
    const t = ctx.currentTime;
    hissGain.gain.cancelScheduledValues(t);
    hissGain.gain.setValueAtTime(0.06, t);
    hissGain.gain.exponentialRampToValueAtTime(0.012, t+0.25);
  }
  btn.addEventListener('click', ()=> ligado ? desliga() : liga());
  return { liga, desliga, corrente, tick, proximo, get ligado(){return ligado} };
})();

document.addEventListener('mouseover', e=>{
  if (e.target.closest('.btn, #bar a, #bar button, #skip, #ligar')) Som.tick();
});

$('#tocando').addEventListener('click', ()=> Som.proximo());

(function grao(){
  if (reduzMotion) return;
  const c = $('#grain'), x = c.getContext('2d');
  const img = x.createImageData(c.width, c.height);
  let vivo = true;
  document.addEventListener('visibilitychange', ()=> vivo = !document.hidden);
  let f = 0;
  (function loop(){
    requestAnimationFrame(loop);
    if (!vivo || (f++ % 2)) return;
    const d = img.data;
    for (let i=0;i<d.length;i+=4){ const v = Math.random()*255|0; d[i]=d[i+1]=d[i+2]=v; d[i+3]=255; }
    x.putImageData(img,0,0);
  })();
})();

// Sem WebGL (#238): driver na lista negra, aceleracao proibida, WebView
// antigo, Tor no modo mais fechado. O three lanca ao criar o renderer, e a
// excecao derrubava o script inteiro ANTES de a intro existir — a pagina
// ficava preta, com REC e um 'pular' que nao fazia nada, para sempre. Agora a
// cena e a unica coisa que falta: o que sobra e um estado com os mesmos campos
// que a intro e o ScrollTrigger escrevem, e `html.sem-webgl` tira o canvas do
// caminho e mostra os elos em HTML (ver globals.css). Som, loja em fotos,
// convite e concierge seguem como sempre.
//
// So que o try/catch embrulha a cena INTEIRA, e "nao criou o contexto" nao e
// a unica coisa que lanca ali: um bug na cena ou uma regressao de three/gsap
// cairiam no mesmo catch e sumiriam com o canvas em silencio — e nenhum teste
// automatico pega regressao de animacao (AGENTS.md). Antes do try a excecao
// saia do init e chegava ao Sentry sozinha; agora e o catch que pergunta ao
// navegador. Sem contexto WebGL, e o esperado: aviso baixo e segue. Com
// contexto, o erro e da cena, e `reporta` o leva ao Sentry com a tag dele.
// A pagina fica igual nos dois casos; o que muda e quem fica sabendo.
function semWebGL(erro){
  if (temWebGL()) {
    console.error('home: a cena 3D falhou com WebGL disponivel.', erro);
    if (reporta) reporta(erro);
  } else {
    console.warn('home: sem WebGL, a cena 3D fica de fora.', erro && erro.message);
  }
  document.documentElement.classList.add('sem-webgl');
  return { S:{ p:0, pAlvo:0, fim:0, fimAlvo:0, queda:1, shake:0, mx:0, my:0 }, camera:null, semGL:true };
}
const GL = (()=>{ try {
  const canvas = $('#gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:false, powerPreference:'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x000000, mobile ? 8 : 6, mobile ? 20 : 16);

  const camera = new THREE.PerspectiveCamera(mobile ? 46 : 38, innerWidth/innerHeight, 0.1, 60);
  camera.position.set(0.7, 0.4, 3.6);

  function envTexture(){
    const w=512,h=256, c=document.createElement('canvas'); c.width=w;c.height=h;
    const x=c.getContext('2d');
    x.fillStyle='#050505'; x.fillRect(0,0,w,h);
    const risco=(cx,cy,rw,rh,col,a)=>{
      const g=x.createRadialGradient(cx,cy,0,cx,cy,rw);
      g.addColorStop(0,col); g.addColorStop(1,'rgba(0,0,0,0)');
      x.globalAlpha=a; x.fillStyle=g;
      x.save(); x.translate(cx,cy); x.scale(1,rh/rw); x.translate(-cx,-cy);
      x.fillRect(cx-rw,cy-rw,rw*2,rw*2); x.restore(); x.globalAlpha=1;
    };
    risco(120,50,240,34,'#ffffff',1);
    risco(420,100,170,20,'#f2f4f8',0.85);
    risco(250,150,90,10,'#ffffff',0.6);
    risco(300,215,220,60,'#e0161f',0.6);
    risco(40,200,100,30,'#7a0a10',0.6);
    const t=new THREE.CanvasTexture(c);
    t.mapping=THREE.EquirectangularReflectionMapping;
    t.encoding=THREE.sRGBEncoding;
    return t;
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(envTexture()).texture;
  scene.environment = env;

  function roughMap(seed, base){
    const s=256, c=document.createElement('canvas'); c.width=c.height=s;
    const x=c.getContext('2d');
    x.fillStyle=`rgb(${base*255|0},${base*255|0},${base*255|0})`; x.fillRect(0,0,s,s);
    let r=seed*9301+49297;
    const rnd=()=>{ r=(r*9301+49297)%233280; return r/233280; };
    x.strokeStyle='rgba(255,255,255,.55)'; x.lineWidth=1;
    for(let i=0;i<70;i++){ x.beginPath(); const y=rnd()*s; x.moveTo(rnd()*s,y); x.lineTo(rnd()*s,y+rnd()*8-4); x.stroke(); }
    for(let i=0;i<40;i++){
      x.fillStyle=`rgba(255,255,255,${rnd()*.35})`;
      x.beginPath(); x.arc(rnd()*s,rnd()*s,rnd()*14+2,0,Math.PI*2); x.fill();
    }
    const t=new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(3,1);
    return t;
  }

  class Estadio extends THREE.Curve {
    constructor(R, s){ super(); this.R=R; this.s=s; }
    getPoint(t, out = new THREE.Vector3()){
      const R=this.R, s=this.s, per = 2*s + 2*Math.PI*R; let u = t*per;
      if (u < s) return out.set(R, -s/2 + u, 0);
      u -= s; if (u < Math.PI*R){ const a=u/R; return out.set(R*Math.cos(a), s/2 + R*Math.sin(a), 0); }
      u -= Math.PI*R; if (u < s) return out.set(-R, s/2 - u, 0);
      u -= s; const a=u/R; return out.set(-R*Math.cos(a), -s/2 - R*Math.sin(a), 0);
    }
  }
  const R_ELO = 0.5, S_ELO = 1.1, R_TUBO = 0.19;
  const ESP = 1.5;
  const geo = new THREE.TubeGeometry(new Estadio(R_ELO, S_ELO), mobile ? 90 : 140, R_TUBO, mobile ? 14 : 22, true);

  const corrente = new THREE.Group();
  corrente.rotation.z = -0.09;
  scene.add(corrente);
  const posLocal = i => new THREE.Vector3(0, -i*ESP, 0);
  const posElo = (i, out = new THREE.Vector3()) => corrente.localToWorld(out.copy(posLocal(i)));

  function novoElo(i, mat){
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(posLocal(i));
    m.rotation.y = (i % 2) * Math.PI/2 + i*0.11;
    corrente.add(m);
    return m;
  }
  const elos = TRACKS.map((t,i)=>{
    const mat = new THREE.MeshStandardMaterial({
      color: 0xf2f3f5,
      metalness: 1,
      roughness: 0.16 + t.rough*0.35,
      roughnessMap: roughMap(i+1, 0.2 + t.rough*0.3),
      envMapIntensity: 1.6,
    });
    return novoElo(i, mat);
  });
  const matSombra = new THREE.MeshStandardMaterial({ color:0xd0d3d8, metalness:1, roughness:0.3, envMapIntensity:1.1 });
  [-4,-3,-2,-1, TRACKS.length, TRACKS.length+1, TRACKS.length+2].forEach(i=> novoElo(i, matSombra));

  const flutuantes = [];
  (function elementos(){
    const lista = CONFIG.elementos.filter(e=>e.url);
    if (!lista.length) return;
    const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
    const vert = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
    const frag = `uniform sampler2D map; uniform float op; varying vec2 vUv;
      void main(){ vec4 c=texture2D(map,vUv); float w=min(min(c.r,c.g),c.b);
        float a=c.a*(1.0-smoothstep(0.90,0.985,w)); if(a<0.02) discard; gl_FragColor=vec4(c.rgb*1.05,a*op); }`;
    const carregadores = new Map();
    lista.forEach(e=>{
      const monta = tex=>{
        tex.encoding = THREE.sRGBEncoding;
        const ar = tex.image.width/tex.image.height;
        const mat = new THREE.ShaderMaterial({ uniforms:{ map:{value:tex}, op:{value:0} }, vertexShader:vert, fragmentShader:frag, transparent:true, depthWrite:false });
        const m = new THREE.Mesh(new THREE.PlaneGeometry(e.escala*ar, e.escala), mat);
        m.userData = { elo:e.elo, lado:e.lado, fase:Math.random()*6.28 };
        scene.add(m); flutuantes.push(m);
      };
      carregadores.set(e, ()=> loader.load(drive(e.url, 900), monta, undefined, ()=>{ if (e.fallback) loader.load(e.fallback, monta); }));
    });

    // Sob demanda (#47). Eram cinco PNGs, 5 MB, baixados no carregamento
    // inicial — inclusive o do ultimo elo, que fica a muitas telas de
    // distancia. Agora cada um baixa quando o elo dele esta a menos de uma
    // tela e meia: o primeiro continua saindo logo, porque fica colado no hero.
    const pedidos = new Set();
    const carrega = e=>{ if (pedidos.has(e)) return; pedidos.add(e); carregadores.get(e)(); };
    if (!('IntersectionObserver' in window)){ lista.forEach(carrega); return; }
    const vigia = new IntersectionObserver(es=>{
      es.forEach(en=>{
        if (!en.isIntersecting) return;
        vigia.unobserve(en.target);
        const i = +en.target.dataset.i;
        lista.filter(e=>e.elo===i).forEach(carrega);
      });
    }, { rootMargin:'150% 0px' });
    const vigiados = new Set();
    lista.forEach(e=>{
      const secao = document.getElementById('elo-'+(e.elo+1));
      // Elemento sem elo na pagina nao tem o que esperar.
      if (!secao){ carrega(e); return; }
      if (!vigiados.has(secao)){ vigiados.add(secao); vigia.observe(secao); }
    });
  })();

  const frases = [];
  function texturaFrase(txt, px){
    const linhas = txt.split('\n');
    const c = document.createElement('canvas'), x = c.getContext('2d');
    const font = `${px}px Anton, Impact, sans-serif`;
    x.font = font;
    const w = Math.ceil(Math.max(...linhas.map(l=>x.measureText(l.toUpperCase()).width)) + px*0.4);
    const lh = px*1.02, hgt = Math.ceil(lh*linhas.length + px*0.4);
    c.width = w; c.height = hgt;
    x.font = font; x.fillStyle = '#fff'; x.textBaseline = 'top';
    linhas.forEach((l,i)=> x.fillText(l.toUpperCase(), px*0.2, px*0.2 + i*lh));
    const t = new THREE.CanvasTexture(c); t.anisotropy = 4; t.encoding = THREE.sRGBEncoding;
    return { t, ar: w/hgt };
  }
  function montaFrases(){
    FRASES.forEach(f=>{
      const { t, ar } = texturaFrase(f.t, mobile ? 72 : 96);
      const alt = (mobile ? 0.55 : 0.62) * f.esc * f.t.split('\n').length * 0.5;
      const mat = new THREE.MeshStandardMaterial({
        color: 0xf4f5f7, metalness: 1, roughness: 0.22, envMapIntensity: 1.9,
        alphaMap: t, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(alt*ar, alt), mat);
      m.userData = { elo:f.elo, lado:f.lado, prof:f.prof, fase:Math.random()*6.28, giro:(Math.random()-.5)*0.5 };
      scene.add(m); frases.push(m);
    });
  }
  (document.fonts && document.fonts.load ? document.fonts.load('96px Anton') : Promise.resolve()).then(montaFrases, montaFrases);

  const vermelho = new THREE.PointLight(0xe0161f, 2.2, 9, 2);
  scene.add(vermelho);
  const branco = new THREE.DirectionalLight(0xffffff, 0.9);
  branco.position.set(-3, 4, 2);
  scene.add(branco);
  scene.add(new THREE.AmbientLight(0x111114, 1));

  const N = mobile ? 1600 : 4200;
  const pA = new Float32Array(N*3), pB = new Float32Array(N*3), pos = new Float32Array(N*3);
  const centroFim = posLocal(TRACKS.length + 0.6);
  (function amostraP(){
    const s=256, c=document.createElement('canvas'); c.width=c.height=s;
    const x=c.getContext('2d'); x.fillStyle='#000'; x.fillRect(0,0,s,s);
    x.fillStyle='#fff'; x.font='bold 230px Anton, Impact, sans-serif';
    x.textAlign='center'; x.textBaseline='middle'; x.fillText('P', s/2, s/2+8);
    x.strokeStyle='#fff'; x.lineWidth=14; x.beginPath(); x.moveTo(60,200); x.lineTo(200,56); x.stroke();
    const d=x.getImageData(0,0,s,s).data, pts=[];
    for(let i=0;i<s*s;i++) if(d[i*4]>128) pts.push(i);
    for(let k=0;k<N;k++){
      const p=pts[(Math.random()*pts.length)|0];
      const px=(p%s)/s-0.5, py=0.5-Math.floor(p/s)/s;
      pB[k*3]=centroFim.x+px*3.2; pB[k*3+1]=centroFim.y+py*3.2-0.2; pB[k*3+2]=centroFim.z+(Math.random()-.5)*0.25;
      const r=1.2+Math.random()*2.4, a=Math.random()*Math.PI*2, h=(Math.random()-.5)*4;
      pA[k*3]=centroFim.x+Math.cos(a)*r; pA[k*3+1]=centroFim.y+h+1.2; pA[k*3+2]=centroFim.z+Math.sin(a)*r;
      pos[k*3]=pA[k*3]; pos[k*3+1]=pA[k*3+1]; pos[k*3+2]=pA[k*3+2];
    }
  })();
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const cores = new Float32Array(N*3);
  for(let k=0;k<N;k++){ const red = Math.random()<0.06; cores[k*3]=red?0.88:0.8; cores[k*3+1]=red?0.09:0.82; cores[k*3+2]=red?0.12:0.86; }
  pGeo.setAttribute('color', new THREE.BufferAttribute(cores,3));
  const pMat = new THREE.PointsMaterial({ size: mobile ? 0.035 : 0.028, vertexColors:true, transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending });
  const particulas = new THREE.Points(pGeo, pMat);
  corrente.add(particulas);

  const S = { p:0, pAlvo:0, fim:0, fimAlvo:0, queda:1, shake:0, mx:0, my:0 };
  addEventListener('pointermove', e=>{ S.mx = (e.clientX/innerWidth-0.5); S.my = (e.clientY/innerHeight-0.5); }, {passive:true});

  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  let ultimoElo = -1, tPrev = performance.now();

  function frame(now){
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.min((now - tPrev)/1000, 0.05); tPrev = now;
    const t = now/1000;

    S.p += (S.pAlvo - S.p) * (1 - Math.pow(0.001, dt));
    S.fim += (S.fimAlvo - S.fim) * (1 - Math.pow(0.001, dt));

    corrente.position.y = (1 - S.queda) * 16;
    corrente.rotation.y = t*0.12 + S.p*1.2 + S.mx*0.35;
    corrente.updateMatrixWorld(true);

    const f = S.p * (TRACKS.length - 1);
    const alvo = posElo(f, tmpA); alvo.y -= corrente.position.y;
    const fimOff = S.fim * 2.4;
    const lado = (Math.floor(f + 0.5) % 2 ? -1 : 1) * (mobile ? 0.1 : 0.75);
    camera.position.x += ((alvo.x + lado) - camera.position.x) * 0.08;
    camera.position.y += ((alvo.y + 0.15 - fimOff - S.my*0.25) - camera.position.y) * 0.08;
    camera.position.z += ((alvo.z + (mobile ? 6.6 : 3.4) + S.fim*1.4) - camera.position.z) * 0.08;
    tmpB.copy(alvo); tmpB.y -= fimOff;
    if (S.shake > 0.001){ tmpB.x += (Math.random()-.5)*S.shake; tmpB.y += (Math.random()-.5)*S.shake; S.shake *= 0.9; }
    camera.lookAt(tmpB);

    vermelho.position.set(camera.position.x + 1.4, camera.position.y - 0.5, camera.position.z - 1.6);
    vermelho.intensity = 1.5 + Math.sin(t*1.7)*0.35 + S.fim*1.5;

    flutuantes.forEach(m=>{
      const d = m.userData, base = posElo(d.elo, tmpB); base.y -= corrente.position.y;
      m.position.set(base.x + d.lado*(mobile?1.5:1.9) + Math.sin(t*0.4+d.fase)*0.18,
                     base.y + 0.3 + Math.cos(t*0.5+d.fase)*0.22,
                     base.z + 0.6 + Math.sin(t*0.3+d.fase)*0.3);
      m.lookAt(camera.position);
      m.rotation.z = Math.sin(t*0.35+d.fase)*0.12;
      const prox = Math.max(0, 1 - Math.abs(d.elo - f)*1.1);
      m.material.uniforms.op.value += (prox*0.95 - m.material.uniforms.op.value)*0.06;
    });

    frases.forEach(m=>{
      const d = m.userData, base = posElo(d.elo, tmpB); base.y -= corrente.position.y;
      const dx = d.lado * (mobile ? 1.4 : 2.3) + Math.sin(t*0.25+d.fase)*0.12;
      m.position.set(base.x + dx, base.y + Math.cos(t*0.32+d.fase)*0.16, base.z + d.prof + Math.sin(t*0.2+d.fase)*0.15);
      m.lookAt(camera.position);
      m.rotateY(d.giro + Math.sin(t*0.3+d.fase)*0.25);
      m.rotation.z += Math.sin(t*0.27+d.fase)*0.05;
      const prox = Math.max(0, 1 - Math.abs(d.elo - f)*0.75);
      m.material.opacity += (prox*0.92 - m.material.opacity)*0.06;
      m.visible = m.material.opacity > 0.01;
    });

    const atual = Math.round(f);
    if (atual !== ultimoElo && S.queda > 0.99){
      ultimoElo = atual;
      Som.corrente(0.6);
      document.querySelectorAll('.elo').forEach((s,i)=> s.classList.toggle('vis', i === atual));
    }

    if (S.fim > 0.001 || pMat.opacity > 0){
      const k = ease(S.fim);
      const arr = pGeo.attributes.position.array;
      for (let i=0;i<N;i++){
        const j=i*3, dr = Math.sin(t*0.8 + i)*0.02*(1-k);
        arr[j]   = pA[j]   + (pB[j]   - pA[j])   * k + dr;
        arr[j+1] = pA[j+1] + (pB[j+1] - pA[j+1]) * k + Math.cos(t*0.6 + i*0.3)*0.015;
        arr[j+2] = pA[j+2] + (pB[j+2] - pA[j+2]) * k;
      }
      pGeo.attributes.position.needsUpdate = true;
      pMat.opacity = Math.min(1, S.fim*2.2);
      elos[TRACKS.length-1].scale.setScalar(1 - k*0.85);
      elos[TRACKS.length-1].material.opacity = 1 - k;
    }
    renderer.render(scene, camera);
  }
  function ease(x){ return x<0.5 ? 2*x*x : 1-Math.pow(-2*x+2,2)/2; }
  elos[TRACKS.length-1].material.transparent = true;
  requestAnimationFrame(frame);

  addEventListener('resize', ()=>{
    camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  return { S, camera };
} catch (erro) { return semWebGL(erro); } })();

gsap.registerPlugin(ScrollTrigger);
ScrollTrigger.create({
  trigger:'#elo-1', start:'center center',
  endTrigger:'#elo-' + TRACKS.length, end:'center center',
  onUpdate: self => { GL.S.pAlvo = self.progress; }
});
ScrollTrigger.create({
  trigger:'#fim', start:'top bottom', end:'bottom bottom',
  onUpdate: self => { GL.S.fimAlvo = self.progress; }
});
ScrollTrigger.create({
  trigger:'#hero', start:'bottom 70%',
  onEnter: ()=> $('#elo-1').classList.add('vis'),
});

(function intro(){
  const el = $('#intro'), html = document.documentElement;
  html.classList.add('locked');
  scrollTo(0,0);

  const tc = $('#tc'); let fr = 0, tcOn = true;
  (function tcLoop(){ if(!tcOn) return; requestAnimationFrame(tcLoop);
    fr++; const f=fr%30, s=Math.floor(fr/30)%60, m=Math.floor(fr/1800)%60;
    tc.textContent = `00:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}:${String(f).padStart(2,'0')}`; })();

  const c=$('#vhs'), x=c.getContext('2d'), img=x.createImageData(c.width,c.height); let vhsOn=true;
  (function vhs(){ if(!vhsOn) return; requestAnimationFrame(vhs);
    const d=img.data; for(let i=0;i<d.length;i+=4){ const v=Math.random()*255|0; d[i]=d[i+1]=d[i+2]=v; d[i+3]=255; }
    x.putImageData(img,0,0);
    x.fillStyle='rgba(255,255,255,.35)'; x.fillRect(0,(Date.now()/12)%c.height,c.width,2); })();

  GL.S.queda = 0;
  const linhas = gsap.utils.toArray('#manifesto .l');
  const tl = gsap.timeline({ defaults:{ ease:'power3.out' } });

  if (reduzMotion){
    tl.to(el, { opacity:0, duration:.3, onComplete: fecha });
    GL.S.queda = 1;
  } else {
    tl.to('#ligar', { opacity:1, duration:.6 }, .4);
    linhas.forEach((l,i)=>{
      const fim = l.classList.contains('fim');
      tl.to(l, { opacity:1, filter:'blur(0px)', y:0, skewX:0, duration: fim ? .9 : .55 }, fim ? '+=.55' : (i? '+=.35' : .6));
      if (!fim) tl.to(l, { opacity:.28, duration:.3 }, '+=.6');
    });
    tl.add(()=>{ Som.corrente(1.4); GL.S.shake = .35; }, '-=.2');
    tl.to(GL.S, { queda:1, duration:1.1, ease:'bounce.out' }, '<');
    tl.to('#manifesto', { opacity:0, y:-20, duration:.6 }, '+=.5');
    tl.to(el, { opacity:0, duration:.9, onComplete: fecha }, '<+.1');
  }

  let fechou = false;
  setTimeout(()=>{ if (!fechou){ tl.kill(); GL.S.queda = 1; fecha(); } }, 19000);
  function fecha(){
    if (fechou) return; fechou = true;
    // O DOM (`#intro` fora, trava solta, barra visivel) e o mesmo que o
    // HomeRuntime deixa quando este script falha (#238): um lugar so.
    fechaAbertura(document);
    vhsOn=false; tcOn=false;
    ScrollTrigger.refresh();
  }
  $('#skip').addEventListener('click', ()=>{ tl.progress(1).kill(); GL.S.queda=1; fecha(); });
  $('#ligar').addEventListener('click', ()=>{ Som.liga(); $('#ligar').style.opacity=0; $('#ligar').disabled=true; });
  // Quem clicou em 'pular' enquanto este script baixava (#238) nao clicou a
  // toa: o clique vale agora, que ha o que pular — pelo mesmo caminho do botao.
  if (pulouAntes) $('#skip').click();
})();

// Modal com saida animada (#49). `fecha` so poe a classe `saindo`; quem tira
// o `on` e o fim da animacao. O prazo e rede de seguranca: aba em segundo
// plano nao dispara `animationend`, e modal que nao fecha e pior que modal
// que fecha sem animar.
// O foco volta para quem abriu — sem isso, quem navega por teclado fecha o
// modal e cai no topo da pagina.
function modalAnimado(el, aoTerminar){
  let quemAbriu = null, prazo = null;
  const termina = ()=>{
    clearTimeout(prazo);
    if (!el.classList.contains('saindo')) return;
    el.classList.remove('on', 'saindo');
    aoTerminar && aoTerminar();
    if (quemAbriu && document.contains(quemAbriu)) quemAbriu.focus({ preventScroll:true });
    quemAbriu = null;
  };
  el.addEventListener('animationend', e=>{ if (e.target === el) termina(); });
  return {
    abre(quem){
      clearTimeout(prazo);
      quemAbriu = quem || document.activeElement;
      el.classList.remove('saindo'); el.classList.add('on');
    },
    fecha(){
      if (!el.classList.contains('on') || el.classList.contains('saindo')) return;
      el.classList.add('saindo');
      prazo = setTimeout(termina, 400);
    },
  };
}

const Loja = (()=>{
  const el = $('#loja'), vit = $('#vitrine'), canvas = $('#glLoja');
  let renderer, scene, camera, camisa, brasao, rotY = 0.35, rotX = 0.05, velY = 0, arrastando = false, ux = 0, uy = 0, aberto = false, pronto = false, usaFotos = null;
  let tam = $('#tamLoja').dataset.padrao || '';
  // Destino do Comprar: /checkout com a escolha na query (#106). O slug vem do
  // dataset, carimbado pelo servidor a partir do catalogo — nao ha nome de
  // produto escrito neste arquivo desde a #99.
  const slugDoProduto = () => $('#tamLoja').dataset.slug || '';
  const link = ()=>{
    const slug = slugDoProduto();
    $('#comprarLoja').href = slug ? `/checkout?p=${encodeURIComponent(slug)}&tam=${encodeURIComponent(tam)}` : '#';
  };
  $('#tamLoja').addEventListener('click', e=>{
    const b = e.target.closest('button'); if(!b) return;
    $$('#tamLoja button').forEach(x=>{ x.classList.toggle('on', x===b); x.setAttribute('aria-pressed', String(x===b)); }); tam = b.dataset.t; link();
  });
  link();

  function silhueta(){
    const s = new THREE.Shape();
    s.moveTo(-0.46, 1.42);
    s.lineTo(-1.12, 1.26);
    s.lineTo(-1.78, 0.58);
    s.lineTo(-1.62, 0.02);
    s.lineTo(-1.06, 0.34);
    s.lineTo(-1.14, -1.52);
    s.lineTo( 1.14, -1.52);
    s.lineTo( 1.06, 0.34);
    s.lineTo( 1.62, 0.02);
    s.lineTo( 1.78, 0.58);
    s.lineTo( 1.12, 1.26);
    s.lineTo( 0.46, 1.42);
    s.quadraticCurveTo(0, 1.02, -0.46, 1.42);
    return s;
  }
  function init(){
    if (pronto) return; pronto = true;
    renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    camera.position.set(0, 0.1, 7.2);

    scene.add(new THREE.HemisphereLight(0x9a9ca3, 0x0a0a0c, 0.9));
    const chave = new THREE.DirectionalLight(0xffffff, 1.1); chave.position.set(2.5, 3, 4); scene.add(chave);
    const contra = new THREE.DirectionalLight(0xe0161f, 0.35); contra.position.set(-3, 1, -3); scene.add(contra);
    const preench = new THREE.DirectionalLight(0xffffff, 0.35); preench.position.set(-2, -1, 3); scene.add(preench);

    camisa = new THREE.Group();
    const geo = new THREE.ExtrudeGeometry(silhueta(), { depth:0.34, bevelEnabled:true, bevelThickness:0.14, bevelSize:0.12, bevelSegments:5, curveSegments:12 });
    geo.center();
    const tecido = new THREE.MeshStandardMaterial({ color:0x0c0c0e, roughness:0.92, metalness:0.0 });
    const corpo = new THREE.Mesh(geo, tecido); camisa.add(corpo);

    const gola = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.065, 10, 40), new THREE.MeshStandardMaterial({ color:0x141416, roughness:0.85 }));
    gola.position.set(0, 1.18, 0.02); gola.scale.set(1, 0.72, 1); camisa.add(gola);

    const tex = new THREE.TextureLoader().load(CONFIG.merchBrasao || '/brasao.png', t=>{ t.encoding = THREE.sRGBEncoding; });
    const bw = 0.92, bh = bw * 393/360;
    brasao = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh, 1, 1), new THREE.MeshStandardMaterial({ color:0xf3f3f3, roughness:0.7, alphaMap:tex, transparent:true, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-2 }));
    brasao.position.set(0, 0.28, 0.34/2 + 0.14 + 0.012);
    camisa.add(brasao);

    scene.add(camisa);

    if (CONFIG.merchModelo && THREE.GLTFLoader){
      const fontes = driveAudio(CONFIG.merchModelo);
      const loader = new THREE.GLTFLoader();
      const tenta = ()=>{
        if (!fontes.length){ console.warn('modelo 3D não carregou'); return; }
        loader.load(fontes.shift(), gltf=>{
          const m = gltf.scene;
          const box = new THREE.Box3().setFromObject(m), tam = new THREE.Vector3(), centro = new THREE.Vector3();
          box.getSize(tam); box.getCenter(centro);
          const k = 3.1 / Math.max(tam.y, 0.001);
          m.position.sub(centro).multiplyScalar(k); m.scale.setScalar(k);
          m.traverse(o=>{ if (o.isMesh && o.material){ o.material.side = THREE.DoubleSide; if ('roughness' in o.material) o.material.roughness = Math.max(o.material.roughness, 0.6); } });
          camisa.clear(); camisa.add(m);
        }, undefined, tenta);
      };
      tenta();
    }

    const down = e=>{ arrastando = true; ux = e.clientX; uy = e.clientY; vit.setPointerCapture && vit.setPointerCapture(e.pointerId); };
    const move = e=>{ if(!arrastando) return; const dx = e.clientX-ux, dy = e.clientY-uy; ux = e.clientX; uy = e.clientY; velY = dx*0.012; rotY += velY; rotX = Math.max(-0.5, Math.min(0.5, rotX + dy*0.006)); };
    const up = ()=>{ arrastando = false; };
    vit.addEventListener('pointerdown', down); vit.addEventListener('pointermove', move);
    vit.addEventListener('pointerup', up); vit.addEventListener('pointercancel', up); vit.addEventListener('pointerleave', up);
    redimensiona();
  }
  function redimensiona(){
    if (!renderer) return;
    const w = vit.clientWidth, hgt = vit.clientHeight;
    renderer.setSize(w, hgt, false); camera.aspect = w/hgt; camera.updateProjectionMatrix();
  }
  addEventListener('resize', ()=> aberto && redimensiona());
  // Orcamento de quadro (#217). Com o modelo de 73 k triangulos, uma GPU por
  // software (CI, celular fraco) gasta centenas de ms por quadro; renderizar em
  // todo requestAnimationFrame deixava a pagina inteira sem responder — o
  // clique no guia de tamanhos nao abria. O intervalo entre quadros segue o
  // custo do quadro anterior: o dobro dele, entre 16 e 250 ms. Em GPU normal
  // o custo e de 1-2 ms e nada muda.
  //
  // Com movimento reduzido a camiseta nao gira nem flutua sozinha: so se mexe
  // quando a pessoa arrasta, e so e redesenhada enquanto se mexe.
  let ultimoQuadro = 0, custo = 0, desenhou = false;
  function loop(){
    if (!aberto) return;
    requestAnimationFrame(loop);
    if (document.hidden) return;
    const agora = performance.now();
    // Intervalo minimo = o triplo do custo do ultimo quadro: no pior caso a
    // vitrine ocupa um terco do tempo e a pagina continua respondendo.
    if (agora - ultimoQuadro < Math.max(16, custo * 3)) return;
    ultimoQuadro = agora;
    if (!arrastando){ velY *= 0.92; rotY += velY + (reduzMotion ? 0 : 0.004); rotX += (0.05 - rotX)*0.03; }
    camisa.rotation.set(rotX, rotY, 0);
    camisa.position.y = reduzMotion ? 0 : Math.sin(agora/1400)*0.04;
    if (reduzMotion && desenhou && !arrastando && Math.abs(velY) < 0.0005) return;
    renderer.render(scene, camera);
    custo = performance.now() - agora; desenhou = true;
  }
  let giro = null, quadro = 0, giroX0 = 0, giroAcc = 0, giroAtivo = false, giroTimer = null;
  // 3D ou fotos (#217)? O modelo da camiseta tem 73 k triangulos com normal
  // map. Em GPU de verdade e barato; em GPU por software — SwiftShader (Chrome
  // sem aceleracao, CI), llvmpipe (VM), aparelho sem driver — cada quadro custa
  // centenas de ms e a pagina inteira para de responder. Para esse aparelho as
  // quatro fotos em 360 sao a experiencia melhor, nao a pior. Decidido uma vez,
  // com um contexto descartavel; o nome da GPU vem da extensao de debug, que
  // o Chrome e o Firefox expoem.
  function gpuPorSoftware(){
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!gl) return true;
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const nome = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
      const solta = gl.getExtension('WEBGL_lose_context'); if (solta) solta.loseContext();
      return /swiftshader|llvmpipe|softpipe|software|mesa offscreen/i.test(nome);
    } catch { return true; }
  }
  function querFotos(){
    if (usaFotos === null) usaFotos = !!CONFIG.merch360 && (!CONFIG.merchModelo || !THREE.GLTFLoader || gpuPorSoftware());
    return usaFotos;
  }
  function init360(){
    if (giro || !CONFIG.merch360) return;
    vit.classList.add('modo-360');
    giro = document.createElement('div'); giro.className = 'giro';
    giro.style.backgroundImage = `url("${CONFIG.merch360}")`;
    vit.insertBefore(giro, vit.firstChild);
    const mostra = i => { quadro = ((i % 4) + 4) % 4; giro.style.backgroundPosition = `${quadro*100/3}% 50%`; };
    const passo = 80;
    vit.addEventListener('pointerdown', e=>{ giroAtivo = true; giroX0 = e.clientX; giroAcc = 0; vit.classList.add('usada'); clearInterval(giroTimer); vit.setPointerCapture && vit.setPointerCapture(e.pointerId); });
    vit.addEventListener('pointermove', e=>{
      if (!giroAtivo) return; giroAcc += e.clientX - giroX0; giroX0 = e.clientX;
      while (giroAcc >= passo){ mostra(quadro - 1); giroAcc -= passo; }
      while (giroAcc <= -passo){ mostra(quadro + 1); giroAcc += passo; }
    });
    const solta = ()=>{ giroAtivo = false; };
    vit.addEventListener('pointerup', solta); vit.addEventListener('pointercancel', solta); vit.addEventListener('pointerleave', solta);
    addEventListener('keydown', e=>{ if (!aberto) return; if (e.key === 'ArrowRight') mostra(quadro + 1); if (e.key === 'ArrowLeft') mostra(quadro - 1); });
    giroTimer = setInterval(()=>{ if (!aberto) return; mostra(quadro + 1); }, 1400);
    mostra(0);
  }
  function abre(t, quem){
    if (querFotos()) init360(); else init();
    if (t){ tam = t; $$('#tamLoja button').forEach(x=>{ x.classList.toggle('on', x.dataset.t===t); x.setAttribute('aria-pressed', String(x.dataset.t===t)); }); link(); }
    modal.abre(quem); aberto = true; document.documentElement.classList.add('locked');
    if (!querFotos()) requestAnimationFrame(()=>{ redimensiona(); loop(); });
    Som.corrente(0.5);
    $('#fecharLoja').focus();
  }
  // `aberto` e a trava de rolagem so caem no FIM da saida: a camiseta continua
  // girando enquanto o modal some, e a pagina de tras nao rola por baixo.
  const modal = modalAnimado(el, ()=>{ aberto = false; document.documentElement.classList.remove('locked'); });
  function fecha(){ modal.fecha(); }
  $('#fecharLoja').addEventListener('click', fecha);
  el.addEventListener('click', e=>{ if (e.target === el) fecha(); });
  addEventListener('keydown', e=>{ if (e.key === 'Escape') fecha(); });
  return { abre, fecha };
})();

(function convite(){
  const form=$('#formConvite'), inp=$('#cod'), erro=$('#erroCod'), sala=$('#sala'), video=$('#salaVideo');
  const modal = modalAnimado(sala);
  const aberto = CONFIG.fase >= 3;
  if (!aberto){ inp.placeholder='em breve'; inp.disabled=true; form.querySelector('button').disabled=true; }
  // Issue #13: a validacao mora no servidor. O cliente nao conhece codigo
  // nenhum, e a URL do teaser so chega depois que o codigo confere.
  const botao = form.querySelector('button');
  // Issue #28: protecao contra bot. A isca e um campo que ninguem ve; o
  // desafio e o token da Cloudflare, pedido so quando a pessoa chega no campo.
  // Os dois vao junto com o codigo, e quem confere e o servidor.
  const isca = form.querySelector('[name="website"]');
  if (aberto && humano) inp.addEventListener('focus', ()=> humano.aquece(), { once:true });
  form.addEventListener('submit', async e=>{
    e.preventDefault(); if(!aberto) return;
    const v = inp.value.trim().toUpperCase();
    // `aria-invalid` acompanha o erro (#51): entra com ele, sai quando a pessoa
    // tenta de novo. A ligacao com a mensagem ja esta no HTML, por
    // aria-describedby.
    if (!v){ erro.textContent='Digita o código do convite.'; inp.setAttribute('aria-invalid','true'); return; }
    inp.removeAttribute('aria-invalid');
    botao.disabled = true; erro.textContent = 'Conferindo…';
    try {
      // Se a Cloudflare pedir que a pessoa marque a caixa, a caixa aparece
      // abaixo do campo e a espera continua: o envio sai quando ela marcar.
      const desafio = humano
        ? await humano.pede(()=>{ erro.textContent = 'Confirma que é humano na caixa abaixo.'; })
        : undefined;
      if (humano) erro.textContent = 'Conferindo…';
      const r = await fetch('/api/convite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ codigo: v, desafio, website: isca ? isca.value : '' }),
      });
      const dados = await r.json().catch(()=>({}));
      if (r.ok && dados.ok){
        erro.textContent='';
        if (dados.teaser){
          video.textContent='';
          const f = document.createElement('iframe');
          f.src = dados.teaser;
          f.allow = 'autoplay; fullscreen';
          f.allowFullscreen = true;
          f.title = 'Teaser';
          video.appendChild(f);
        }
        modal.abre(inp); Som.corrente(1); $('#fecharSala').focus();
      } else {
        erro.textContent = dados.erro || 'Esse código não abre nada aqui.';
        inp.setAttribute('aria-invalid','true');
        inp.select(); Som.tick();
      }
    } catch {
      erro.textContent = 'Não deu pra conferir agora. Tenta de novo.';
      Som.tick();
    } finally {
      botao.disabled = false;
      // Token vale um envio: o proximo precisa de outro.
      if (humano) humano.renova();
    }
  });
  // Botao e Esc fecham pelo mesmo caminho, com a mesma animacao (#49).
  $('#fecharSala').addEventListener('click', ()=> modal.fecha());
  addEventListener('keydown', e=>{ if(e.key==='Escape') modal.fecha(); });
  // Quem ja tem o cookie assinado volta direto para a sala, sem redigitar.
  // A checagem e preguicosa de proposito: so custa um request para quem
  // clica em convite, nao para todo visitante que abre a home.
  async function abreSeJaLiberado(){
    try {
      const r = await fetch('/api/convite');
      if (!r.ok) return false;
      const dados = await r.json();
      if (!dados.ok) return false;
      if (dados.teaser && !video.querySelector('iframe')){
        video.textContent='';
        const f = document.createElement('iframe');
        f.src = dados.teaser;
        f.allow = 'autoplay; fullscreen';
        f.allowFullscreen = true;
        f.title = 'Teaser';
        video.appendChild(f);
      }
      modal.abre($('#linkConvite')); $('#fecharSala').focus();
      return true;
    } catch { return false; }
  }
  $('#linkConvite').addEventListener('click', async ()=>{
    if (await abreSeJaLiberado()) return;
    setTimeout(()=> inp.focus({preventScroll:true}), 600);
  });
})();
}
