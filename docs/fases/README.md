# Fases — plano executável

Este diretório é o **plano de desenvolvimento** do Banca. Um arquivo por fase, com pré-condições,
etapas numeradas, tarefas com checkbox, critérios de aceite verificáveis e registro de execução.

Divisão de papéis com o plano (registrada no Apêndice B do plano, v1.4):

| | [`docs/project-plan.md`](../project-plan.md) | `docs/fases/F<n>-*.md` |
|---|---|---|
| Responde | **por quê** e **o quê** | **como** e **em que ordem** |
| Contém | arquitetura, modelo de dados, máquina de estados, contrato do dossiê, edge cases | etapas, tarefas, aceite executável, progresso |
| Muda quando | a arquitetura muda (com registro no Apêndice B) | o trabalho avança |
| É dono de | intenção e decisões | tarefas e **critérios de aceite** |

Implementar uma fase é sempre pela skill [`implementar-fase`](../../.claude/skills/implementar-fase/SKILL.md).
Ela lê estes arquivos, executa os aceites de verdade e encerra com a revisão de impacto nas fases
seguintes.

## Estado

| Fase | Status | Estimativa | Depende de |
|---|---|---|---|
| [F0 — Fundação e spikes](F0-fundacao-e-spikes.md) | ⏳ em andamento (iniciada 2026-08-07) | 1–2d | — |
| [F1 — Banco e domínio](F1-banco-e-dominio.md) | ⬜ não iniciada | 1–2d | F0 |
| [F2 — Runner e execução de jobs](F2-runner-e-jobs.md) | ⬜ não iniciada | 3–4d | F0, F1 |
| [F3 — Correção com Claude](F3-correcao-com-claude.md) | ⬜ não iniciada | 3–5d | F0, F1, F2 |
| [F4 — Fila, estados e resiliência](F4-fila-estados-e-resiliencia.md) | ⬜ não iniciada | 2–3d | F1, F2, F3 |
| [F5 — API e intake](F5-api-e-intake.md) | ⬜ não iniciada | 2–3d | F1, F4 |
| [F6 — Front](F6-front.md) | ⬜ não iniciada | 4–6d | F5 |
| [F7 — Hardening, verificadores e testes](F7-hardening-e-testes.md) | ⬜ não iniciada | 3–5d | F3, F4, F5, F6 |
| [F8 — Multiusuário e web](F8-multiusuario-e-web.md) | ⬜ não iniciada | a dimensionar | F7 |
| [F9 — Integração FC](F9-integracao-fc.md) | ⬜ não iniciada | a dimensionar | F5, F6 |

**Marco do MVP: fim da F7.** F8 e F9 são pós-aprovação e propositalmente não dimensionadas —
F8 depende de números que só a operação real produz, F9 depende de respostas da equipe da plataforma.

Marcadores: `⬜` não iniciada · `⏳` em andamento (com data de início) · `✅` implementada (com data).
O mesmo marcador aparece no arquivo da fase, nesta tabela e no §13 do plano;
[`tests/fases.test.ts`](../../tests/fases.test.ts) quebra o build se divergirem.

**Fase implementada leva a conclusão no nome do arquivo**: `F1-banco-e-dominio.md` vira
`F1-banco-e-dominio-concluida.md` no encerramento. Um `ls docs/fases/` passa a contar o estado do
projeto sem abrir nada. `⬜` e `⏳` mantêm o nome original — cada fase é renomeada uma vez só, no fim —
e o guard exige que sufixo do arquivo e marcador de status digam a mesma coisa: renomear sem fechar a
fase quebra tanto quanto fechar sem renomear.

## Ordem e dependências

`Depende de` lista apenas dependências **diretas** — as transitivas ficam implícitas.

```
F0 ─┬─→ F1 ─┬─────────────→ F5 ──→ F6 ─┐
    │       ├─→ F2 ─┬─→ F4 ──┘         │
    ├───────┘       │      │           │
    └─────→ F3 ←────┘      │           │
             │             │           │
             └─────────────┴──→ F7 ────┴──→ F8
                                 │
                          F5, F6 └──────→ F9
```

Leitura curta: **F0 prova os riscos · F1 dá o banco · F2 dá o container · F3 dá o corretor · F4 dá a
fila e a resiliência · F5 dá a API · F6 dá as telas · F7 endurece e testa.**

## Pendências humanas que destravam fases (plan §17)

| Ação | Destrava | Estado |
|---|---|---|
| §17.1 — completar `docs/skills-map.csv` (projeto, fase, revisão dos modos) | F1 | pendente |
| §17.2 — coletar e congelar os golden repos G1–G10 | F3 (G1–G3), F7 (G1–G10) | pendente |
| §17.3 — rodar `claude setup-token` e guardar no `.env` | F0 (spike S1) | pendente |
| §17.4 — `.wslconfig` (`processors=6`) e desativar suspensão | F2 (paralelismo real), F7 | pendente |
| §17.5 — validar decisões ainda reversíveis (NestJS+Prisma, PrimeVue, nome) | F1 em diante | pendente |
| §17.7 — decidir o destino do `SKILLS_DIR` fora de `.claude/` | F8 | pendente |

Pendência não resolvida **bloqueia** a fase: a skill manda parar e perguntar, não inventar substituto.

## Como marcar progresso

Durante a fase, marque `[x]` cada tarefa assim que ela estiver pronta e verificada — o arquivo da
fase é o mapa de retomada de uma sessão nova. Ao encerrar: o arquivo é renomeado com o sufixo
`-concluida`, o marcador de status muda nos três lugares (arquivo da fase, esta tabela, §13 do plano)
junto com os links que apontam para o nome antigo, o "Registro de execução" é preenchido e a revisão
de impacto nas fases seguintes é feita antes de declarar a fase concluída. O procedimento completo
está na skill `implementar-fase`; `pnpm test` verifica o resultado.
