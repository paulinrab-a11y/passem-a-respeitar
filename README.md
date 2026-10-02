# Passem a Respeitar — site do EP (Santxx x Ch3fe / Whynot Visuals)

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
  not-found.tsx         página de não encontrado (#173)
  global-error.tsx      último recurso, quando o layout raiz quebra (#8)
  globals.css           CSS da identidade, extraído verbatim do site original
  _home/
    config.ts           CONFIG tipado (links, assets, faixas, beats)
    HomeRuntime.tsx     carrega three.js e GSAP por dynamic import
    Galeria.tsx         fotos da merch, com next/image (#47)
    legacy-site.js      script original, verbatim, embrulhado numa função
  _ui/                  peças que se repetem: mensagem, rótulo de botão,
                        barra de rota, reautenticação, campos de formulário
  entrar/               login (#31)
  criar-conta/          cadastro com verificação de e-mail (#30)
  recuperar-senha/      pedido do link (#32)
  redefinir-senha/      senha nova, a partir do link (#32)
  auth/callback/        volta dos links de e-mail (#30, #32, #36)
  conta/                perfil (#35)
    seguranca/          senha, e-mail, sessões e exclusão (#36 a #39)
    pedidos/            lista e detalhe, com linha do tempo (#41, #42)
    admin/pedidos/      mudança de status, só para administrador (#43)
  checkout/             entrega e pagamento (#106, #108)
  privacidade/          política de privacidade (#109)
  api/
    convite/            validação do código de convite
    conta/foto/         upload da foto de perfil (#26)
    conta/resumo/       o mínimo que a barra da home precisa saber
    checkout/pagamento/ cria a cobrança no Mercado Pago
    mercado-pago/webhook/  confirmação de pagamento (#45)
    cron/conciliacao/   rede de segurança do webhook (#114)
lib/
  convite.ts            hash, comparação em tempo constante, cookie assinado
  rate-limit.ts         limite no Upstash, com queda para memória (#22, #121)
  robo.ts               proteção contra bot: isca e conferência do token (#28)
  rotas.ts              quem exige sessão, destino seguro, host principal
  site-url.ts           endereço do site e origem do pedido
  admin.ts              quem administra, pela lista do ambiente
  esquemas.ts           validação de entrada, com zod
  contato.ts            o endereço de contato do site
  conta/
    perfil.ts           consulta e mapper explícito da resposta
    pedidos.ts          rótulo, tom e mapper dos pedidos
    linha-do-tempo.ts   etapas do pedido, a partir da trilha
    foto.ts             regras de upload: tipo real, tamanho, normalização
    senha.ts            medidor de força (roda nos dois lados)
    senha-servidor.ts   checagem contra vazamento por k-anonymity
    reautenticacao.ts   janela de autenticação recente, lida do banco
    sessoes.ts          leitura de user-agent e rede, mapper da lista
  loja/                 catálogo, preço, frete, pedido, cobrança, webhook,
                        conciliação e transições de status
  supabase/
    env.ts              lê as variáveis, falha fechada
    tipos.ts            gerado do schema
    navegador.ts        client do browser, chave publishable
    servidor.ts         client de servidor, sessão nos cookies
    admin.ts            chave secreta, ignora RLS — só servidor
proxy.ts                CSP com nonce por request, sessão, host principal
                        (até o Next 15 se chamava middleware.ts)
e2e/                    testes de ponta a ponta (Playwright)
  apoio/                ambiente, servidor de teste, cenário, e-mail, telas
public/
  elementos/            os cinco elementos cromados, em WebP sem perda
  merch/                fotos, modelo 3D e textura da camiseta
  beats/                as faixas que tocam na home
                        logo.png, brasao.png, saturno.png (sem uso desde a #145)
motion-audits/          relatório do audit de motion (#53)
supabase/
  config.toml           Supabase LOCAL, só para a suíte de ponta a ponta
  migrations/           SQL versionado, aplicado em ordem de nome
  templates/            e-mails de conta e o guia para o painel (#183)
  tests/                testes de RLS e das funções do banco
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

## Frete

O frete é calculado pelo CEP, pelo Melhor Envio, com o preço dos Correios
(#199). Depois de digitar o CEP, a pessoa escolhe entre os serviços que o
Melhor Envio devolver, PAC ou SEDEX. Hoje só o SEDEX aparece, e o dono decidiu
que basta: ele entrega em qualquer região (#201).

| Regra | Por quê |
|---|---|
| O navegador manda o serviço, nunca o preço | o servidor cota de novo ao criar o pedido |
| A mesma pergunta tem a mesma resposta por 30 minutos | o preço da tela é o que entra no pedido |
| Sem cotação, sem pedido | frete zero por falha não existe |
| Em produção, só o Melhor Envio de produção | token de sandbox seria preço de mentira |
| 30 consultas a cada 10 minutos, por pessoa | cada consulta usa o token do dono |

O pedido grava o valor, o serviço e o prazo cotado. O serviço aparece na lista
do administrador: é a postagem que se compra para aquele pedido. Etiqueta e
rastreio ainda são feitos no painel do Melhor Envio.

Peso e medidas são do produto, no banco. Produto sem medida não tem frete, e o
checkout diz que o frete está indisponível.

O prazo mostrado é o do transporte, em dias úteis, e começa depois da produção
de pelo menos 30 dias (#197).

## Proteção contra bot

Login, cadastro, recuperação de senha e o campo de convite da home têm duas
barreiras (#28), e nenhuma delas mora no navegador:

| Barreira | O que é | Quem confere |
|---|---|---|
| Isca | campo fora da tela, do teclado e do leitor de tela | o servidor: preenchido, recusa |
| Desafio | Cloudflare Turnstile, tema escuro, em português | o servidor pergunta à Cloudflare se o token vale |

O token vale uma vez e por cinco minutos. Cada resposta do servidor pede um
novo. Quem envia antes de o token chegar não recebe erro: o envio espera e sai
sozinho.

Quase sempre a Cloudflare se convence sozinha. Quando não, ela pede que a
pessoa marque uma caixa; quem envia sem marcar lê, no lugar do erro do
formulário, o que falta fazer.

O widget tem lugar reservado desde o primeiro quadro, e o botão não anda quando
ele chega. Em tela de até 335 px vai o formato compacto: o largo não encolhe
abaixo de 300 px e esticaria o formulário.

A ordem dentro de cada ação:

1. isca preenchida ou envio sem token: recusa, sem gastar tentativa do limite
2. limite de tentativas
3. conferência do token na Cloudflare, que é uma chamada para fora
4. o que o formulário faz

Falha fechada: Cloudflare fora do ar recusa o envio. Em produção, chave
faltando ou chave de teste também recusam, e o Sentry recebe o aviso.

Na política de segurança, o widget abriu **um** host, em `frame-src`, e só nas
quatro páginas que têm formulário público. Na home, o script da Cloudflare só
carrega quando a pessoa chega no campo de convite.

O que isto **não** cobre: quem fala direto com a API do Supabase, sem passar
pelo site. Lá quem segura é o limite do próprio Supabase.

A suíte de ponta a ponta roda com as chaves de teste que a Cloudflare publica:
o widget sempre passa, e a conferência aceita qualquer token.

## E-mails de conta

Confirmação de cadastro, recuperação de senha, troca de e-mail e os avisos de
segurança saem pelo Supabase Auth, em português (#183, #185). São treze
modelos, um para cada linha do painel do Supabase, com uma moldura só. O site
dispara cinco deles; os outros existem para nenhum e-mail sair em inglês.

| Onde | O que é |
|---|---|
| `supabase/templates/modelos.mjs` | os textos e a moldura; é aqui que se mexe |
| `supabase/templates/*.html` | saída do gerador; não editar à mão |
| `supabase/templates/guia.html` | página para colar os modelos no painel |

Para mudar um texto:

```
npm run emails:gera
```

O Supabase local lê os `.html` pelo `supabase/config.toml`, e a suíte de ponta a
ponta confere o e-mail que chega. **Produção não lê o repositório**: os modelos
ficam no painel do Supabase, e depois de mudar um texto é preciso abrir o
`guia.html` no navegador e colar de novo.

Os e-mails não têm imagem nem nada de fora: chegam inteiros com imagem
bloqueada, e não avisam ninguém de que foram abertos.

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
| `npm run emails:gera` | regrava os e-mails de conta e o guia do painel |

## Deploy

Produção é a branch `main`. Cada PR gera um Preview Deploy.

Nunca dê push direto na `main` — existe um hook `pre-push` que recusa. O fluxo
é Issue → branch → PR → CI verde → merge.

## Qualidade

O CI roda em todo PR: `lint → typecheck → test → build → e2e`, mais `secrets`
(gitleaks sobre o histórico e a árvore) e `audit` (`npm audit --audit-level=high`)
em paralelo. PR só é mergeado com tudo verde — por disciplina, não por trava:
ver "Pendências conhecidas".

Commits em Conventional Commits, validados por Commitlint no `commit-msg`.
O tipo `sec:` é específico deste repo, para commit de segurança.

### Testes

Vitest, em `lib/**/*.test.ts` e `app/**/*.test.{ts,tsx}`. Rodam sem banco e sem
rede: o que depende de Supabase usa variável de ambiente falsa via
`vi.stubEnv`.

A cobertura mede `lib/`, `app/` e o middleware. `app/_home/` fica de fora: é o
script legado portado verbatim, e quem cobre aquilo é o Playwright (#10), não
teste de unidade. O piso está em
85% e reprova o job; é piso, não meta. O que importa é **o que** está coberto:
a comparação do código de convite e a assinatura do cookie.

Nenhum teste usa o código de convite real, nem o hash dele. Hash de código
curto cai em dicionário, e repositório privado hoje pode não ser amanhã.

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

Esperando decisão ou conta do dono:

- Domínio final (#54). Na troca: Site URL e Redirect URLs do Supabase,
  `NEXT_PUBLIC_SITE_URL` e os registros de e-mail do domínio
- E-mail transacional: registros do domínio e teste de entrega em Gmail,
  Outlook e Apple Mail (#55). Os modelos em português estão prontos (#183)
- Hospedagem do clipe; até lá a home mostra "clipe em breve" (#75)
- Link de pré-save ainda não existe; o botão mostra "Pré-save em breve"
- Credenciais de produção do Mercado Pago, e o primeiro pagamento real (#45)
- Frete: conta e token do Melhor Envio, CEP de origem, peso e medidas da
  camiseta embalada (#199)

Limites que não são defeito:

- O vermelho da identidade em texto pequeno fica em 4,3 para 1, e a WCAG AA
  pede 4,5. Decisão do dono em 29/09/2026: a marca fica com um vermelho só
  (#176). O teste de acessibilidade conta essas ocorrências, tela a tela
- Branch protection não está disponível: exige GitHub Pro em repositório
  privado (#7). "Merge só com CI verde" é regra seguida, não regra imposta
- Conferência com leitor de tela ainda não foi feita. A verificação automática
  (#175) acha por volta de um terço dos problemas
- Nenhum teste automático pega regressão de animação. Subir `three` ou `gsap`
  exige abrir o site e olhar
