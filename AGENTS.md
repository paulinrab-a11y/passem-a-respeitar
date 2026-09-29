# AGENTS.md — Passem a Respeitar (site oficial)

Este arquivo é lido por qualquer agente de IA (Claude Code, Cursor, Codex, Copilot etc.) que trabalhe neste repositório. Siga tudo aqui antes de qualquer tarefa.

## Projeto
Site do EP "Passem a Respeitar" (Santxx x Ch3fe, Whynot Visuals). Lançamento 20/11/2026.
Identidade: preto / cinza / vermelho, texturas VHS-metal-concreto, logo "P", lettering "Passem A Respeitar" em fonte Amstrong. Toda UI nova respeita essa identidade.
Hospedagem: Vercel (projeto `passem-a-respeitar`). Produção = branch `main`.

## Fluxo de trabalho (obrigatório)
1. Toda tarefa (bug, melhoria, feature) começa com uma Issue no GitHub. Labels: security, feature, bug, motion, infra, docs. Issue tem contexto, critérios de aceite em checklist e como testar.
2. Uma branch por Issue: `feat/<n>-desc`, `fix/<n>-desc`, `sec/<n>-desc`.
3. Nunca push direto na `main`. Deploy acontece apenas via Pull Request (Preview Deploy na Vercel → merge → produção).
4. Descrição do PR obrigatoriamente: `Closes #<n>`, o que mudou, como testar, link do preview da Vercel.
5. Merge só com CI verde (lint, typecheck, testes, build), sem secrets no diff e checklist de segurança revisada.
6. Commits em Conventional Commits (feat, fix, sec, chore, docs, refactor, test).

## Segurança (checklist em todo PR)
- Sem API keys/tokens no código ou no bundle. Só variáveis de ambiente. Cliente recebe apenas chaves públicas.
- RLS ativada e testada em toda tabela com dado de usuário. Toda query filtra pelo usuário da sessão.
- Auth verificada no servidor (middleware + handler). Nenhuma rota de dado de usuário sem sessão.
- Inputs validados no servidor com schema (zod). Whitelist de campos (sem mass assignment).
- Respostas de API enxutas: nunca retornar hash, token, coluna interna ou dado de outro usuário.
- Rate limit em login (por IP e por e-mail) e nas rotas de API. Bot protection nos formulários públicos.
- Cookies HttpOnly + Secure + SameSite. HTTPS forçado + HSTS. Security headers (CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy).
- Senhas só com hash (bcrypt/argon2id). Troca de senha exige senha atual e invalida outras sessões.
- Uploads restritos por tipo, tamanho e nome. Conteúdo exclusivo só por URL assinada.
- `npm audit` sem alta/crítica. Lockfile commitado. Revisar nome exato de pacote novo.

## Observabilidade, qualidade e testes
- Sentry (client + server, source maps). Vercel Analytics / Speed Insights.
- Biome (lint/format), Knip, Commitlint + Husky.
- Vitest (unit/integração) e Playwright (e2e) para os fluxos de auth, conta e pedidos. Cobertura reportada.
- CI (GitHub Actions) roda lint → typecheck → testes → build em todo PR.

## Motion e carregamento (obrigatório em toda UI)
Skill de referência: `kylezantos/design-motion-principles` (instalar com `npx skills add kylezantos/design-motion-principles`). Lentes: Emil Kowalski como principal (contenção/velocidade), Jakub Krehel para polimento de loading, Jhey Tompkins só em momentos de marca da home.
- Skeleton com formato real para todo conteúdo dependente de dados. Zero layout shift.
- Lazy loading de imagens, vídeos e PNGs 3D. Code splitting por rota.
- Entrada de página/seção: fade + translate curto (150–250 ms, ease-out). Stagger discreto e limitado.
- Saída animada em modal, drawer, toast e troca de rota (AnimatePresence / View Transitions).
- Estado de loading e progresso em todo botão/ação assíncrona; barra de progresso em navegação e upload; feedback de sucesso/erro.
- Só animar `transform` e `opacity`. Respeitar `prefers-reduced-motion`. Sem loops chamando atenção.
- Antes de fechar um PR de UI, rodar o modo Audit da skill e tratar os gaps.
- `three` e `gsap` ficam fora do update automatico em minor e major. Nenhum teste
  automatico pega regressao de animacao: lint, typecheck e build passam com a
  intro quebrada. Subir essas duas exige abrir o site e olhar.

## Regras gerais
- Não invente integração, dado ou credencial. Se faltar informação, abra Issue com label `blocked` e pergunte.
- Não altere identidade visual, logo ou lettering sem aprovação.
- Português nos textos de interface; código e commits em inglês.
