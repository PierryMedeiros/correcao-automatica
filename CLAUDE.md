# CLAUDE.md

## O que é este projeto

Banca: sistema de correção assistida por IA para desafios de alunos da Full Cycle. Fluxo: intake de submissões → fila → correção autônoma (Claude Code headless dentro de um container runner isolado) → revisão humana → envio da devolutiva. Roda local (WSL2 + Docker Engine) no MVP.

## Fonte da verdade

`docs/project-plan.md` define tudo: arquitetura (§3), stack (§4), modelo de dados (§5), máquina de estados (§6), contrato do dossiê (§7), runner (§8), fluxos (§9), edge cases (§10), fases com critérios de aceite (§13).

- Antes de implementar qualquer coisa, leia a seção relevante do plano. Não confie em memória.
- Se a implementação precisar divergir do plano: pare, atualize o plano (registrando o porquê no Apêndice B) e só então implemente. Plano e código nunca contam histórias diferentes.
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
docs/              # project-plan.md, STATUS.md, INTEGRATION.md, spikes.md, runbook.md
scripts/           # utilitários
compose.yaml       # Postgres de desenvolvimento
```

## Comandos (contrato; materializar na F0)

- `docker compose up -d` — Postgres de dev
- `pnpm dev` — api + web em watch
- `pnpm test` — unidade · `pnpm test:e2e` — golden repos
- `pnpm lint` — eslint + prettier
- `pnpm db:migrate` / `pnpm db:seed` — Prisma

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

- Ordem: fases F0→F7 do plan §13. Os critérios de aceite de cada fase são a definição de pronto.
- F0 primeiro, spikes antes de código de produção: S1 (headless + token — risco nº 1), S2 (netns), S3 (compose sem portas + network externa). Resultados vão em `docs/spikes.md`.
- Testes nascem junto com o código que testam (parser, máquina de estados e validador do dossiê têm suite desde o primeiro commit que os cria).
- Commits: conventional commits (`feat:`, `fix:`, `docs:`, `chore:`), mensagem em português — só quando o usuário pedir (regra dura 9), sempre pela skill `commit-e-push`.
- Ao encerrar a sessão: atualizar `docs/STATUS.md` (feito / em andamento / próximo passo / decisões).

## Convenções

- Termos de domínio em português, como no plano e no banco: `submissao`, `correcao`, `devolutiva`, `run`, `dossie`, `gatilho`. Código genérico (variáveis, helpers) em inglês.
- TypeScript strict em todo o monorepo; sem `any` silencioso.
- Banco em snake_case; TS em camelCase (Prisma faz o mapeamento).
- Datas em UTC no banco; exibição em America/Sao_Paulo no front.