# CLAUDE.md

## O que é este projeto

Banca: sistema de correção assistida por IA para desafios de alunos da Full Cycle. Fluxo: intake de submissões → fila → correção autônoma (Claude Code headless dentro de um container runner isolado) → revisão humana → envio da devolutiva. Roda local (WSL2 + Docker Engine) no MVP.

## Fonte da verdade

Dois documentos, com papéis distintos e sem sobreposição:

- **`docs/project-plan.md` — arquitetura e intenção.** Define arquitetura (§3), stack (§4), modelo de dados (§5), máquina de estados (§6), contrato do dossiê (§7), runner (§8), fluxos (§9), edge cases (§10), observabilidade (§12) e o índice das fases (§13). É o registro do porquê, e porquê não expira.
- **`docs/fases/F<n>-<slug>.md` — execução.** Dono das tarefas e dos **critérios de aceite** de cada fase: pré-condições, etapas numeradas, tarefas com checkbox, aceite verificável, escopo negativo, impacto em fases seguintes. Índice consolidado em `docs/fases/README.md`.

Regras:

- Antes de implementar qualquer coisa, leia a seção relevante do plano **e** o arquivo da fase. Não confie em memória.
- Se a implementação precisar divergir: **arquitetura muda no plano primeiro** (com o porquê no Apêndice B), depois no arquivo da fase, depois no código. Tarefa ou aceite que se mostrou errado muda direto no arquivo da fase, com a razão no "Registro de execução". Plano, arquivo de fase e código nunca contam histórias diferentes.
- Marcador de status de fase (`⬜`/`⏳`/`✅`) vive em três lugares — arquivo da fase, índice e §13 — e `tests/fases.test.ts` quebra se divergirem. Ao mudar um, mude os três.
- Fase implementada é renomeada para `F<n>-<slug>-concluida.md`, para o `ls` de `docs/fases/` mostrar o estado do projeto. O sufixo e o marcador `✅` são a mesma informação e o guard exige que concordem; os links do índice e do §13 acompanham o rename.
- `docs/STATUS.md` diz onde paramos. Leia no início de toda sessão; atualize ao encerrar.

## Stack

pnpm workspaces · Vue 3 + Vite + Pinia + PrimeVue (`apps/web`) · NestJS 11 + TypeScript strict (`apps/api`) · Prisma + Postgres 16 (jsonb, pg_trgm) · pg-boss (fila e cron, sem Redis) · SSE · runner Docker próprio (`runner/`) · Claude Code headless autenticado por `CLAUDE_CODE_OAUTH_TOKEN`.

## Layout

```
apps/web/          # SPA Vue
apps/api/          # NestJS (REST, SSE, fila, Job Controller, janitor)
packages/shared/   # tipos de domínio, dossie.schema.json, parser de bloco
runner/            # Dockerfile, entrypoint.sh, prompt-template.md
skills-correcao/   # skills corrige-* (fonte dos critérios de correção — conteúdo, não código)
docs/              # project-plan.md, STATUS.md, INTEGRATION.md,
                   # spikes.md (nasce na F0), runbook.md (nasce na F7)
docs/fases/        # README.md (índice) + F0..F9 — plano executável de cada fase
scripts/           # utilitários; scripts/hooks/ = guards executáveis das regras duras
compose.yaml       # Postgres de desenvolvimento
```

## Comandos

Node fixado em `.nvmrc` (24); pnpm vem por corepack, versão pinada em `packageManager`.

Já funcionam:

- `docker compose up -d` — Postgres de dev
- `pnpm test` — vitest · `pnpm test:watch`
- `pnpm lint` — eslint + prettier · `pnpm format` — prettier --write
- `pnpm typecheck` — tsc --noEmit
- `pnpm guards` — selftest dos hooks de `scripts/hooks/`

Nascem com a fase que os torna possíveis (não são dívida, são sequência):

- `pnpm db:migrate` / `pnpm db:seed` — Prisma, na F1
- `pnpm dev` — api + web em watch, quando as apps existirem (F5/F6)
- `pnpm test:e2e` — golden repos, na F7

## Arquitetura de código

- Módulos NestJS por domínio (intake, submissoes, correcoes, runs, jobs, devolutivas, notificacoes) com services finos. **Sem clean architecture completa** — para este tamanho de sistema, camadas de use-case/entity são cerimônia.
- Inversão de dependência **só** nas fronteiras que o plano já prevê trocar: `OrigemDriver`, `EnvioDriver`, `LlmExecutor` (CLI headless hoje; SDK/API key depois). Interface nova fora dessas três = justificar no commit.
- `packages/shared` é o dono dos tipos de domínio, do JSON Schema do dossiê e do parser de bloco. `api` e `web` importam de lá; nunca duplicar tipos.
- Regra de ouro: código direto e óbvio vence abstração especulativa. YAGNI até o plano dizer o contrário.

## Regras duras (nunca violar)

1. Nunca `docker system prune`, prune global de volumes/imagens ou equivalente. Limpeza é sempre por label `fc.job=<id>` / prefixo `fc-job-` (janitor, plan §8).
2. Toda criação Docker do sistema (runner, networks, stacks) carrega o label/prefixo do job.
3. Estados e transições de submissão são exatamente os do plan §6. Estado novo = atualizar o plano primeiro.
4. Migrations só via Prisma; nunca alterar o banco na mão.
5. Segredos só via `.env` (gitignored). Nunca em código, log, commit ou prompt de agente.
6. `Celular:` de aluno é descartado no parser e nunca persiste.
7. `devolutivas.texto_agente` é imutável; edição humana vai em `texto_final`.
8. Não implementar coisas de fases futuras sem registrar a decisão no STATUS.md.
9. `git commit` e `git push` só mediante pedido explícito do usuário. Nunca commitar por iniciativa própria — nem ao terminar uma fase, nem "para não perder o trabalho". Quando o usuário pedir, seguir obrigatoriamente a skill `commit-e-push`.

## Fluxo de trabalho

- Ordem: fases F0→F7 (índice no plan §13, plano executável em `docs/fases/`). Os critérios de aceite do arquivo da fase são a definição de pronto, e são executados de verdade — não presumidos. Implementar fase é sempre pela skill `implementar-fase`.
- Toda fase encerra com **revisão de impacto nas fases seguintes**: o que foi decidido, renomeado, adiado ou descoberto é procurado nos arquivos das fases posteriores e atualizado lá. Doc que envelhece em silêncio é a falha que essa revisão existe para impedir.
- F0 primeiro, spikes antes de código de produção: S1 (headless + token — risco nº 1), S2 (netns), S3 (compose sem portas + network externa). Resultados vão em `docs/spikes.md`.
- Testes nascem junto com o código que testam (parser, máquina de estados e validador do dossiê têm suite desde o primeiro commit que os cria).
- Commits: conventional commits (`feat:`, `fix:`, `docs:`, `chore:`), mensagem em português — só quando o usuário pedir (regra dura 9), sempre pela skill `commit-e-push`.
- Manutenção das instruções: ao editar este arquivo ou qualquer skill em `.claude/skills/`, releia os demais e verifique a coerência entre eles. Instrução aqui e instrução em skill que se contradizem fazem o agente escolher sozinho qual obedecer — e a escolha é invisível. Contradição encontrada se resolve antes de commitar, e a resolução vai na mensagem do commit.
- Ao encerrar a sessão: atualizar `docs/STATUS.md` (feito / em andamento / próximo passo / decisões).

## Convenções

- Termos de domínio em português, como no plano e no banco: `submissao`, `correcao`, `devolutiva`, `run`, `dossie`, `gatilho`. Código genérico (variáveis, helpers) em inglês.
- TypeScript strict em todo o monorepo; sem `any` silencioso.
- Banco em snake_case; TS em camelCase (Prisma faz o mapeamento).
- Datas em UTC no banco; exibição em America/Sao_Paulo no front.