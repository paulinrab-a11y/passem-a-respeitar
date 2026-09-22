# Passem a Respeitar — site do EP (Santxx x Ch3fe / WhyNot Records)

Site oficial do EP. Lançamento **20.11.2026**.
Produção: https://passem-a-respeitar-paulin7.vercel.app

Next.js 15 (App Router) + TypeScript, hospedado na Vercel. A home é a página
original do site portada para JSX sem alteração visual: intro VHS, manifesto,
hero, os 7 elos com elementos cromados em three.js, seção do clipe, merch com
loja 3D e a sala do convite.

## Estrutura

```
app/
  layout.tsx            fontes (next/font), metadata, viewport
  page.tsx              markup da home, renderizado no servidor
  globals.css           CSS da identidade, extraído verbatim do site original
  _home/
    config.ts           CONFIG tipado (links, assets, faixas, beats)
    HomeRuntime.tsx     carrega three.js e GSAP por dynamic import
    legacy-site.js      script original, verbatim, embrulhado numa função
  api/convite/route.ts  validação do código de convite (servidor)
lib/
  convite.ts            hash, comparação em tempo constante, cookie assinado
  rate-limit.ts         limite por IP (provisório, em memória — ver #22)
middleware.ts           CSP com nonce por request
public/                 logo.png, brasao.png, saturno.png
```

**`legacy-site.js` é intocável por padrão.** É o script do site original, mantido
byte a byte para o diff continuar auditável contra o deploy antigo. Está fora do
Biome de propósito. Mudanças nele só com motivo declarado no commit — até hoje,
duas: a migração e a validação do convite no servidor.

## Rodar localmente

```
npm install
npm run dev
```

http://localhost:3000

Para testar o que depende de build de produção — CSP com nonce, middleware,
rotas de API — o `dev` não serve:

```
npm run build && npm run start
```

## Variáveis de ambiente

Copie `.env.example` para `.env.local` e preencha. O arquivo lista todos os
nomes e diz a qual Issue cada bloco pertence.

A regra que não se negocia: **`NEXT_PUBLIC_*` vai para o bundle do navegador e
qualquer visitante lê.** Esse prefixo é só para chave pública. Chave de serviço,
token de gateway e segredo de webhook nunca.

Sem `CONVITE_CODIGOS_HASH` configurada, a rota de convite recusa qualquer
código. Falha fechada, de propósito.

## Scripts

| Script | O que faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` | build de produção |
| `npm run start` | serve o build de produção |
| `npm run lint` | Biome (lint + format) |
| `npm run lint:fix` | corrige o que o Biome consegue |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run knip` | código e dependência mortos |

## Deploy

Produção é a branch `main`. Cada PR gera um Preview Deploy.

Nunca dê push direto na `main` — existe um hook `pre-push` que recusa. O fluxo
é Issue → branch → PR → CI verde → merge.

## Qualidade

O CI roda em todo PR: `lint → typecheck → test → build`, mais `secrets`
(gitleaks sobre o histórico e a árvore) e `audit` (`npm audit --audit-level=high`)
em paralelo. PR só é mergeado com tudo verde.

Commits em Conventional Commits, validados por Commitlint no `commit-msg`.
O tipo `sec:` é específico deste repo, para commit de segurança.

## Como trabalhar aqui

Leia **[AGENTS.md](AGENTS.md)** antes de qualquer tarefa. Vale para pessoas e
para agentes de IA: fluxo de trabalho, checklist de segurança e as regras de
motion e carregamento.

## Pendências conhecidas

- Botão "Comprar" da merch sem destino — checkout Mercado Pago (#44, #45)
- Clipe, fotos da merch, modelo 3D e beats ainda em links públicos de Google
  Drive e Dropbox, sem expiração (#14)
- Links de pré-save e Instagram sem destino real (#58)
- Sem banco e sem área de conta ainda (#12, #29 a #45)
- Rate limit em memória, por instância — trocar por Upstash (#22)
- Branch protection não disponível: exige GitHub Pro em repositório privado (#7)
