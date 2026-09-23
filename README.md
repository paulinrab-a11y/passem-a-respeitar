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
supabase/
  migrations/           SQL versionado, aplicado em ordem de nome
  tests/                testes de RLS
```

## Banco

Supabase (`cbac principal`, sa-east-1). O schema mora em
`supabase/migrations/` e cada arquivo e aplicado uma vez, na ordem do nome.

A regra que organiza o modelo inteiro: **o cliente le, o servidor escreve.**
`authenticated` tem `SELECT` em `orders`, `order_items` e
`order_status_history` e nada mais. Pedido e criado e alterado por rota de
servidor, que calcula o total a partir do catalogo — preco que chega do
navegador e sugestao, nao preco.

Sao tres barreiras, e cada uma sozinha ja barraria:

| Barreira | O que ela decide |
|---|---|
| `GRANT` | se o papel pode escrever, e em quais **colunas** |
| RLS | quais **linhas** o papel alcanca |
| trigger | `user_id` de pedido nao muda nem por `service_role` |

A separacao importa: policy nunca restringe coluna. Quem impede mass assignment
em `profiles` e o `grant update (nome, telefone)`, nao a policy.

`supabase/tests/rls-pedidos.sql` cria dois usuarios e confere o que um alcanca
do outro — 22 casos. Roda no SQL Editor do Supabase; ainda nao no CI, que e a
Issue #10.

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
| `npm test` | Vitest, uma passada |
| `npm run test:watch` | Vitest em watch |
| `npm run test:coverage` | Vitest com cobertura e piso |

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

### Testes

Vitest, em `lib/**/*.test.ts`. Rodam sem banco e sem rede: o que depende de
Supabase usa variável de ambiente falsa via `vi.stubEnv`.

A cobertura mede só `lib/`. `app/_home/` é o script legado portado verbatim —
quem cobre aquilo é o Playwright (#10), não teste de unidade. O piso está em
85% e reprova o job; é piso, não meta. O que importa é **o que** está coberto:
a comparação do código de convite e a assinatura do cookie.

Nenhum teste usa o código de convite real, nem o hash dele. O repositório é
público e hash de código curto cai em dicionário.

## Como trabalhar aqui

Leia **[AGENTS.md](AGENTS.md)** antes de qualquer tarefa. Vale para pessoas e
para agentes de IA: fluxo de trabalho, checklist de segurança e as regras de
motion e carregamento.

## Pendências conhecidas

- Botão "Comprar" da merch sem destino — checkout Mercado Pago (#44, #45)
- Link de pré-save ainda não existe; o botão mostra "em breve" (#58)
- Clipe fora do ar até subir no YouTube (#75)
- Schema e RLS prontos (#18), mas sem cliente Supabase nem área de conta
  (#29 a #45)
- Rate limit em memória, por instância — trocar por Upstash (#22)
- Branch protection não disponível: exige GitHub Pro em repositório privado (#7)
