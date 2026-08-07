# Banca

Sistema de correção assistida por IA para desafios de alunos da Full Cycle.

Hoje a correção é manual: abrir o Claude Code, colar o desafio, esperar, colar a devolutiva — um por um, ~50 por dia. A Banca transforma isso em um pipeline: **colar as entregas no intake → revisar as devolutivas → clicar em enviar.** O resto é orquestração determinística.

> **Estado:** pré-F0. O plano está escrito e revisado; ainda não há código. Veja [`docs/STATUS.md`](docs/STATUS.md).

## Como funciona

```
intake (colar bloco) → validação do repo → fila → correção autônoma → revisão humana → envio
```

Cada correção é uma invocação nova e stateless do Claude Code headless, rodando dentro de um container runner isolado (rede própria, labels por job). O agente clona o repo do aluno no commit pinado, segue a **skill** do desafio como única fonte de critérios, executa o projeto de verdade quando a skill exige e entrega um `dossie.json` validado contra JSON Schema. O backend nunca interpreta prosa: veredito, evidências e devolutiva vêm estruturados.

Princípios que sustentam o desenho:

- **Orquestração é código, não LLM** — enfileirar, paralelizar, persistir e limpar são do backend.
- **Isolamento por construção** — namespace de rede por job, portas despublicadas, project name único. Colisão de porta é impossível, não proibida.
- **Nada destrutivo global** — teardown por job + janitor por label. `docker system prune` não existe no vocabulário do sistema.
- **Humano no loop com trava** — a política do run define o caminho feliz, mas dossiê com dúvidas, veredito inconclusivo ou gatilho disparado **sempre** vai para revisão.
- **Perder correção é bug** — retry com limite, timeout, recuperação de órfãos no boot, pausa automática ao bater o limite do plano.

## Arquitetura

```
[SPA Vue] ⇄ REST + SSE ⇄ [API NestJS] ⇄ [Postgres]
                              │
                         [pg-boss (fila, cron)]
                              │  N workers
                       [Job Controller]
                              │ docker run (1 container por correção)
                    ┌─────────┴──────────┐
                    │ runner fc-job-<id> │  ← rede própria, label fc.job=<id>
                    │  claude -p + skill │
                    └─────────┬──────────┘
                              │ socket do host
                    [stacks compose -p fc-job-<id>, sem ports publicadas]
```

Detalhes em [`docs/project-plan.md`](docs/project-plan.md) §3 (arquitetura) e §8 (runner).

## Stack

pnpm workspaces · Vue 3 + Vite + Pinia + PrimeVue · NestJS 11 + TypeScript strict · Prisma + Postgres 16 (jsonb, `pg_trgm`) · pg-boss (fila e cron, sem Redis) · SSE · runner Docker próprio · Claude Code headless autenticado por `CLAUDE_CODE_OAUTH_TOKEN`.

Roda local (WSL2 + Docker Engine) no MVP. Sem login, sem deploy web — ficam para a F8.

## Layout

```
apps/web/          # SPA Vue
apps/api/          # NestJS (REST, SSE, fila, Job Controller, janitor)
packages/shared/   # tipos de domínio, dossie.schema.json, parser de bloco
runner/            # Dockerfile, entrypoint.sh, prompt-template.md
skills-correcao/   # skills corrige-* (critérios de correção — conteúdo, não código)
docs/              # plano, status, integração, spikes, runbook
compose.yaml       # Postgres de desenvolvimento
```

## Comandos

Contrato definido no plano; materializado na F0.

| Comando | O que faz |
|---|---|
| `docker compose up -d` | Postgres de dev |
| `pnpm dev` | api + web em watch |
| `pnpm test` / `pnpm test:e2e` | unidade / golden repos |
| `pnpm lint` | eslint + prettier |
| `pnpm db:migrate` / `pnpm db:seed` | Prisma |

## Documentação

| Arquivo | Para quê |
|---|---|
| [`docs/project-plan.md`](docs/project-plan.md) | **Fonte da verdade.** Arquitetura, modelo de dados (§5), máquina de estados (§6), contrato do dossiê (§7), runner (§8), edge cases (§10), fases e critérios de aceite (§13) |
| [`docs/STATUS.md`](docs/STATUS.md) | Onde paramos: feito, em andamento, próximo passo, decisões |
| [`docs/INTEGRATION.md`](docs/INTEGRATION.md) | O que **não** sabemos da API da plataforma FC: premissas e perguntas abertas para a equipe, antes de escrever o driver |
| [`CLAUDE.md`](CLAUDE.md) | Regras para quem desenvolve com IA neste repo |

O plano é documento vivo: mudança de arquitetura passa por ele **antes** de virar código, com o porquê registrado no Apêndice B. Plano e código nunca contam histórias diferentes.

## Roadmap

F0 fundação e spikes · F1 banco e domínio · F2 runner e jobs · F3 correção com Claude · F4 fila, estados e resiliência · F5 API e intake · F6 front · F7 hardening e testes → **MVP**. Depois: F8 (multiusuário e web) e F9 (integração com a plataforma FC).

Critérios de aceite de cada fase em [`docs/project-plan.md`](docs/project-plan.md) §13.
