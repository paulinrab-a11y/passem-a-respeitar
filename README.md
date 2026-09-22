# Passem a Respeitar — site do EP (Santxx x Ch3fe / WhyNot Records)

Site estático de um único arquivo, baixado do deploy de produção na Vercel
(projeto `passem-a-respeitar`, conta paulin7 — https://passem-a-respeitar-paulin7.vercel.app).
Os 4 arquivos em `src/` são idênticos aos do deploy (mesmos SHA-1).

## Estrutura
- `src/index.html` — página inteira (HTML + CSS + JS). Usa GSAP/ScrollTrigger e three.js via CDN.
- `src/logo.png` — logo "Passem A Respeitar" (fonte Amstrong, lettering do Canva)
- `src/brasao.png` — brasão CBAC (camiseta / merch)
- `src/saturno.png` — elemento cromado da faixa 03

## Rodar localmente
Precisa de um servidor HTTP (abrir o arquivo direto com file:// quebra os fetch/CDN):

    cd src
    npx serve .          # ou: python -m http.server 8080

Depois abra http://localhost:3000 (serve) ou http://localhost:8080 (python).

## Publicar de novo na Vercel
    npx vercel --prod

(Na raiz do projeto, com `src` como Root Directory, ou rode o comando dentro de `src/`.)

## Pendências conhecidas
- Botão "Comprar" do merch ainda sem destino.
- PNGs cromados das faixas 01, 02 e 04 (corrente, mão com máscaras, logo P) ainda não estão no site.
- Fotos das camisetas e o clipe de Blick ficam numa pasta do Google Drive (ver `CONFIG` no index.html).
