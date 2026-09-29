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
  entrar/               login (#31)
  conta/                perfil (#35), senha, sessões e exclusão (#37, #38, #39)
  api/convite/route.ts  validação do código de convite (servidor)
  api/conta/foto/       upload da foto de perfil (#26)
lib/
  convite.ts            hash, comparação em tempo constante, cookie assinado
  rate-limit.ts         limite por IP (provisório, em memória — ver #22)
  conta/
    perfil.ts           consulta e mapper explícito da resposta
    foto.ts             regras de upload: tipo real, tamanho, normalização
    senha.ts            medidor de força (roda nos dois lados)
    senha-servidor.ts   checagem contra vazamento por k-anonymity
    reautenticacao.ts   janela de autenticação recente, lida do banco
    sessoes.ts          leitura de user-agent e rede, mapper da lista
  supabase/
    env.ts              lê as variáveis, falha fechada
    tipos.ts            gerado do schema
    navegador.ts        client do browser, chave publishable
    servidor.ts         client de servidor, sessão nos cookies
    admin.ts            chave secreta, ignora RLS — só servidor
middleware.ts           CSP com nonce por request
public/                 logo.png, brasao.png, saturno.png (sem uso desde a #145)
supabase/
  migrations/           SQL versionado, aplicado em ordem de nome
  tests/                testes de RLS
```

## Banco

Supabase (`cbac principal`, sa-east-1). O schema mora em
`supabase/migrations/` e cada arquivo é aplicado uma vez, na ordem do nome.

A regra que organiza o modelo inteiro: **o cliente lê, o servidor escreve.**
`authenticated` tem `SELECT` em `orders`, `order_items` e
`order_status_history` e nada mais. Pedido é criado e alterado por rota de
servidor, que calcula o total a partir do catálogo — preço que chega do
navegador é sugestão, não preço.

São três barreiras, e cada uma sozinha já barraria:

| Barreira | O que ela decide |
|---|---|
| `GRANT` | se o papel pode escrever, e em quais **colunas** |
| RLS | quais **linhas** o papel alcança |
| trigger | `user_id` de pedido não muda nem por `service_role` |

A separação importa: policy nunca restringe coluna. Quem impede mass assignment
em `profiles` é o `grant update (nome, telefone)`, não a policy.

### Exclusão de conta e LGPD

Quando alguém exclui a conta, o perfil, a foto e as sessões somem. **Os pedidos
ficam, sem dono.**

A LGPD permite reter por obrigação legal (Art. 16, II), e dado anonimizado sai
do alcance da lei (Art. 12). Apagar a venda junto seria perder o registro
fiscal de dinheiro que entrou; bloquear a exclusão de quem já comprou seria
recusar um direito previsto em lei.

O `user_id` do pedido vira nulo e `anonimizado_em` guarda quando. O trigger
que protege o dono do pedido ganhou uma exceção **de mão única**: de dono para
nulo pode; transferir pedido de uma pessoa para outra continua impossível,
e pedido anonimizado não ganha dono de volta.

`supabase/tests/rls-pedidos.sql` cria dois usuários e confere o que um alcança
do outro — 22 casos. Roda no SQL Editor do Supabase; ainda não no CI, que é a
Issue #10.

### Os três clients

| Arquivo | Chave | Poder |
|---|---|---|
| `navegador.ts` | publishable | o que a RLS deixar |
| `servidor.ts` | publishable | o mesmo, com a sessão lida dos cookies |
| `admin.ts` | **secreta** | tudo; ignora RLS |

`servidor.ts` usa a mesma chave pública do navegador de propósito: quem define
quem o usuário é, é a sessão, e a RLS continua valendo. Ele não tem poder
nenhum a mais.

`admin.ts` só existe para o que o usuário legitimamente não faz sozinho: criar
pedido com preço vindo do catálogo, confirmar pagamento por webhook, mudar
status, apagar conta. **Fora disso, use `clienteServidor()`.**

Para ler o usuário no servidor, use `usuarioDaSessao()` — nunca `getSession()`.
`getSession()` lê o cookie e acredita nele; `getUser()` manda o token ao
Supabase, que confere a assinatura. Cookie chega do navegador, e o que chega do
navegador é afirmação, não fato.

Para a chave secreta nunca chegar ao navegador, três travas:

1. `import 'server-only'` — o build quebra se o arquivo entrar em árvore de
   client component
2. sem prefixo `NEXT_PUBLIC_` — o Next não inlina a variável no bundle
3. passo no CI que planta um canário no lugar da chave e o procura no `.next`

E `lib/supabase/fronteira.test.ts` caminha pelos imports a partir do client do
navegador, falhando se algum arquivo alcançável mencionar a chave.

### A foto de perfil

É o único upload do site, e passa por quatro peneiras, da mais barata para a
mais cara:

1. `content-length` — corta antes de ler o corpo
2. extensão — `.jpg`, `.jpeg`, `.png`, `.webp`
3. **bytes mágicos** — o `Content-Type` do formulário é escolhido por quem
   envia; um `.php` renomeado chega anunciando `image/png`
4. `sharp` — reescreve em WebP 512×512, o que também joga fora o EXIF (e com
   ele a coordenada de GPS que a câmera do celular grava sem avisar)

SVG fica de fora de propósito: é XML, aceita `<script>` dentro, e servido na
origem certa vira XSS.

O bucket é **privado**. Bucket público serve por URL adivinhável — quem
descobre o padrão lista a foto de qualquer usuário a partir do id dele. A
leitura sai por URL assinada de 10 minutos, gerada no servidor.

`supabase/tests/rls-avatares.sql` confere que um usuário não alcança o arquivo
do outro.

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
| `npm run e2e:banco` | sobe o Supabase local (precisa de Docker) |
| `npm run test:e2e` | Playwright, contra o build de produção e o banco local |
| `npm run e2e:banco:parar` | derruba o Supabase local |

## Deploy

Produção é a branch `main`. Cada PR gera um Preview Deploy.

Nunca dê push direto na `main` — existe um hook `pre-push` que recusa. O fluxo
é Issue → branch → PR → CI verde → merge.

## Qualidade

O CI roda em todo PR: `lint → typecheck → test → build → e2e`, mais `secrets`
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

### Ponta a ponta

Playwright, em `e2e/`. Cobre cadastro, login, logout, troca de senha,
recuperação de senha, pedidos, a tela administrativa e o caso negativo: um
usuário tentando abrir o pedido de outro.

```
npm run e2e:banco     # uma vez; precisa do Docker aberto
npm run test:e2e
```

A suíte roda contra o **build de produção** do site e contra um **Supabase
local**, que o `e2e:banco` sobe em Docker e que recebe as migrations de
`supabase/migrations` num banco vazio. Produção não é tocada:

- `e2e/apoio/ambiente.mjs` recusa qualquer endereço que não seja desta máquina
- `e2e/apoio/servidor.mjs` esvazia as variáveis de Redis, Sentry e Mercado
  Pago antes do build, para o `.env.local` de quem desenvolve não entrar
- os e-mails ficam presos no servidor de SMTP local, e é de lá que os testes
  leem os links de confirmação

Nenhuma credencial está escrita nos testes. E-mail e senha nascem de bytes
aleatórios a cada rodada; as chaves são as do banco local, lidas do
`supabase status`.

Feche o `npm run dev` antes de rodar: a suíte faz o próprio build, usa a porta
3000 e a pasta `.next`.

## Como trabalhar aqui

Leia **[AGENTS.md](AGENTS.md)** antes de qualquer tarefa. Vale para pessoas e
para agentes de IA: fluxo de trabalho, checklist de segurança e as regras de
motion e carregamento.

## Pendências conhecidas

- Botão "Comprar" da merch sem destino — checkout Mercado Pago (#44, #45)
- Link de pré-save ainda não existe; o botão mostra "em breve" (#58)
- Clipe fora do ar até subir no YouTube (#75)
- Área de conta em construção: login (#31), perfil (#35), logout (#33), troca
  de senha (#37) e a entrada na barra (#34) prontos; falta cadastro (#30),
  recuperação de senha (#32) e pedidos (#41, #42)
- Sem skeleton de carregamento: qualquer `<Suspense>` no carregamento inicial
  prende a página no fallback nesta versão do Next (#46)
- Rate limit em memória, por instância — trocar por Upstash (#22)
- Branch protection não disponível: exige GitHub Pro em repositório privado (#7)
