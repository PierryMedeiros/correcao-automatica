# STATUS

Atualizado em: 2026-08-06 (setup inicial — antes do primeiro dia de código)

## Feito

- `docs/project-plan.md` v1.0 escrito e revisado (achados e correções no Apêndice B do próprio plano)
- Repo criado; `CLAUDE.md` na raiz

## Em andamento

- Nada

## Próximo passo

- F0 (plan §13): montar monorepo pnpm + `compose.yaml` de dev, depois rodar os spikes na ordem S1 → S2 → S3, documentando em `docs/spikes.md`
- Pendências humanas que destravam fases (plan §17): CSV do skills_map, golden repos G1–G10, `claude setup-token`, ajuste do `.wslconfig`

## Decisões recentes

- 2026-08-06: NestJS + Prisma, PrimeVue, pg-boss, pnpm workspaces, nome-código "Banca" (justificativas no plan §4)
- 2026-08-06: auth do runner via `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`), não por montagem de credenciais