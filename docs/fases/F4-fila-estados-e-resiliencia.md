# F4 — Fila, estados e resiliência

> **Status:** ⬜ não iniciada
> **Estimativa:** 2–3 dias úteis (plan §13)
> **Depende de:** F1 (banco) · F2 (Job Controller) · F3 (correção real)
> **Destrava:** F5 (a API enfileira e lê estado) · F7 (resiliência que o E2E exercita)
> **Seções do plano:** §6 e §6.1 (máquina de estados) · §5 (`submissoes`, `correcoes`, `runs`, `eventos`, `notificacoes`, `config`) · §9.2 passo 6 · §9.5 · §12 (pausa global, eventos, cron) · §10.5, 10.7, 10.9, 10.10, 10.11, 10.12, 10.20, 10.21, 10.28 · Apêndice B (06/08) itens 7 e 9 · Apêndice B v1.3 item 1

## Objetivo

No fim da fase o sistema não perde correção: a API vira processo com ciclo de vida próprio, toda submissão
anda por transições legais e persistidas do §6, a fila é do pg-boss dentro do próprio Postgres, falha e
timeout consomem retry até o teto de 3 execuções, limite de plano e credencial inválida pausam o sistema
sem gastar retry, cancelamento e substituição matam o runner em voo, um restart é recuperado no boot em vez
de deixar submissão em `corrigindo`, e o run acaba: lote inteiro terminal vira `finalizado` e libera o próximo.

## Pré-condições

- [ ] F1, F2 e F3 marcadas ✅ no `docs/project-plan.md` §13
- [ ] `pnpm db:migrate` sobe do zero e o banco tem `submissoes`, `correcoes`, `runs`, `eventos`, `notificacoes`, `config` (§5) — conferir com `\dt` no psql do container do `compose.yaml`
- [ ] Índice único parcial de submissão ativa existe (§5) — conferir com `\d submissoes` que a cláusula `WHERE` exclui `enviada`, `cancelada`, `substituida`
- [ ] `apps/api` existe como pacote TypeScript com Prisma Client, Job Controller e janitor (F1 D2, F2 D2), ainda sem `main.ts` nem DI — o bootstrap do Nest é a etapa **F4.0** desta fase, não pré-condição
- [ ] `correcoes.transcript_path` é **NOT NULL** (F1, §5): toda linha de `correcoes` — inclusive a marcada `nao_executada` do §10.10 — nasce com o caminho do job dir. Se em algum cenário a F4 precisar criar a linha antes de haver job dir, isso é divergência do §5 e muda no plano primeiro. `finished_at` e `duracao_s`, ao contrário, são nulos enquanto a correção está `rodando`
- [ ] Job Controller (F2) expõe `abortarJob` (kill + teardown por `fc.job=<id>`) e o harness `pnpm job-fake`, com o seam `FC_PAYLOAD_CMD`, continua rodando
- [ ] Rotina de recuperação de órfãos da F2 (F2.8) existe: marca correção `rodando` como `falhou` ("órfã pós-reinício") e aborta os recursos Docker do job — a F4 a chama, não a reimplementa
- [ ] `LlmExecutor` (interface) e `ClaudeCliExecutor` (implementação CLI headless) existem — entrega da F3 (CLAUDE.md, fronteiras de inversão)
- [ ] F3 persiste `correcoes` com `veredito`, `dossie`, `duracao_s`, `transcript_path` e o rascunho da devolutiva — a F4 lê esses campos, não os escreve
- [ ] `config` semeado pela F1 (F1.7) tem `timeout_job_padrao_s` = 1500 e `pausa_global` como **objeto** `{ ativa, motivo, desde, tentativas }` — `SELECT chave, valor FROM config WHERE chave IN ('timeout_job_padrao_s','pausa_global')`
- [ ] Postgres de dev de pé (`docker compose up -d`) e `.env` com `DATABASE_URL` e um `CLAUDE_CODE_OAUTH_TOKEN` **válido** (o aceite A2 precisa provar a retomada depois de forjar um token inválido)

## Decisões do plano que esta fase materializa

| Decisão | Onde está | Consequência prática nesta fase |
|---|---|---|
| 3 execuções totais por submissão (`retry_n` ≤ 3), semântica unificada | §10.9, Apêndice B (06/08) item 7 | `retry_n` é derivado por contagem de `correcoes`, não por contador mutável |
| `nao_executada` não consome retry | §5 (`correcoes.status`), §6, §10.10 | A pausa devolve a submissão a `na_fila` de graça; a contagem ignora essas linhas |
| "Ativo" é o complemento de `{enviada, cancelada, substituida}` | §5, Apêndice B v1.3 item 1 | `estaAtiva` (F1) nunca enumera status positivamente — estado novo entra como ativo sozinho, e a F4 reusa a função em vez de criar a sua |
| `link_invalido` não é terminal e tem transição própria para `enviada` | §6, Apêndice B (06/08) item 2 | A tabela de transições aceita `link_invalido → enviada`; tratá-lo como terminal é bug |
| `sem_skill` tem saída por reprocessar | §6, Apêndice B (06/08) item 3 | `reprocessar` recusa `sem_skill` enquanto a skill não estiver resolvida |
| Dúvida, gatilho ou veredito `inconclusivo` forçam revisão, contra qualquer política | §2.7, §6 | A regra de destino pós-correção é um `OR`, e a política é só um dos termos |
| Na pausa, job em andamento termina; job novo não inicia | §12 | `boss.stop({ wait: true })` no shutdown e checagem de pausa no início do handler |
| Correção órfã pós-reboot é marcada antes de voltar à fila, e o retorno consome retry | §10.12, Apêndice B (06/08) item 9 | A marcação é da rotina da F2 (F2.8); a F4 só transiciona a submissão depois dela. Sem marcação o loop é infinito; com ela, 3 reboots seguidos terminam em `erro` |
| 1 run ativo por vez no MVP, com `runs.status` em `ativo, pausado, finalizado, cancelado` | §5 (`runs.status`), §6.1, §10.21 | A invariante é do domínio/banco e vale sobre `ativo`; sem transição para fora de `ativo` (F4.7) o sistema aceitaria um único run na vida. A UI só reflete (F6) |
| Logs pino com `job_id`/`submissao_id` em toda linha | §12 | O logger nasce no bootstrap (F4.0) e é a base da evidência de todo aceite desta fase |
| Job dir referenciado por correção fica 14 dias, inclusive `falhou`/`timeout` | §11, Apêndice B v1.3 item 3 | Nenhum caminho de erro desta fase apaga job dir ou transcript |
| Handler de fila é idempotente por obrigação | CLAUDE.md, skill `implementar-fase` | Todo handler faz claim por estado antes de qualquer efeito |

## Decisões a tomar nesta fase

| # | Pergunta em aberto | Opções | Recomendação |
|---|---|---|---|
| D1 | Quem conta o retry: pg-boss ou o domínio? | `retryLimit` do pg-boss · `retry_n` em `correcoes` | Domínio, com `retryLimit: 0` no pg-boss — duas contagens divergem e a do pg-boss não aparece na UI nem no histórico |
| D2 | Enfileirar na mesma transação da transição para `na_fila`? | adapter `db` do pg-boss dentro do `$transaction` do Prisma · enfileirar após o commit + reconciliação | Tentar a transação única (a skill pede); se o adapter não compuser com o `$transaction`, enfileirar pós-commit — a reconciliação de `na_fila` sem job já é obrigatória por §10.12 e cobre o gap |
| D3 | Quem é a autoridade do timeout: Job Controller ou `expireInSeconds`? | Job Controller mata o runner · pg-boss expira o job | Job Controller; `expireInSeconds` = timeout efetivo + margem de teardown, como rede de segurança. Se o pg-boss expira primeiro, sobra container órfão |
| D4 | Mecanismo da pausa global | Pausar a fila no pg-boss · checar a flag no handler · ambos | Ambos: pausar evita girar em falso, a checagem no handler é a autoridade (cobre o job já em voo quando a pausa chega) |
| D5 | Intervalos da retomada automática — o §10.10 diz "escalonado" e não dá números | 5/15/30/60 min com teto · backoff exponencial puro · fixo | 5/15/30/60 min, teto de 60, na chave `retomada_intervalos_min` de `config` (semeada na F1.7) para calibrar na F7 sem deploy |
| D6 | Status da correção em voo interrompida por cancelamento/substituição — o enum do §5 não tem `cancelada` | `falhou` + `erro_resumo` · `nao_executada` · valor novo no enum | `falhou` com `erro_resumo` explícito; valor novo no enum é mudança de §5 e não paga o preço (a submissão já é terminal, não há retry a proteger) |
| D7 | Como "reprocessar zera a contagem de retry" convive com `retry_n` derivado | Contar só correções posteriores ao último evento `submissao.reprocessada` · coluna `retry_base` (migration) · contador mutável | Marco em `eventos` — a tabela append-only já existe (§12) e não exige migration nem campo redundante |
| D8 | Invariante de 1 run ativo: índice ou check em serviço? | Índice único parcial em `runs WHERE status='ativo'` (migration na F4) · validação no service em transação | Índice, pela mesma razão do índice de submissão ativa: corrida vira impossível, não improvável. Se a F1 já o criou, a F4 só cobre com teste |

## Etapas

### F4.0 — Bootstrap mínimo da aplicação

**Entrega:** `apps/api` deixa de ser biblioteca e passa a ser processo com ciclo de vida — start, shutdown ordenado, configuração e logger — sem nenhuma rota HTTP.

**Arquivos:** `apps/api/src/main.ts`, `apps/api/src/app.module.ts`, `apps/api/src/common/config.module.ts`, `apps/api/src/common/logger.ts`, `apps/api/src/common/erros.ts`

**Tarefas**

- [ ] `main.ts` subindo o `AppModule` como **contexto de aplicação** (sem servidor HTTP; a F5 troca por servidor ao acrescentar controllers), com só os módulos desta fase pendurados — `fila`, `submissoes`, `correcoes`, `runs`, `sistema` — e nenhum controller, DTO ou SSE
- [ ] Módulo de configuração lendo o `.env` uma vez e validando presença de `DATABASE_URL`, `JOBS_DIR`, `SKILLS_DIR`, `RUNNER_IMAGE` e `CLAUDE_CODE_OAUTH_TOKEN`: falta de variável derruba o start, não o primeiro job; nenhum valor de segredo em log (regra dura 5)
- [ ] Logger pino como provider, com `job_id`/`submissao_id` em todo log da fila e do worker (§12)
- [ ] Exception filter de domínio para os erros tipados desta fase; o filter HTTP é da F5
- [ ] `enableShutdownHooks()` + SIGTERM/SIGINT para que o `onModuleDestroy` da fila (F4.2) rode de verdade, e Prisma Client como provider desconectando no shutdown — o provider embrulha `criarPrisma(url)` de `apps/api/src/db/client.ts` (F1), que é quem monta o driver adapter que o Prisma 7 exige
- [ ] Resolver como o build do Nest consome `@banca/shared`: a F1 deixou o pacote publicando `./src/index.ts` direto, sem build (funciona em vitest e `tsx`, que transformam TS). Se o `tsc` do Nest não aceitar o arranjo, a saída é dar um `build` ao shared e apontar o `exports` para `dist/` — decisão desta etapa, registrada no STATUS.md, não improviso no meio da F5
- [ ] O código TS puro de F1/F2 (`jobs/`, `janitor/`) continua sendo função chamada — o bootstrap embrulha, não reescreve (F1 D2, F2 D2)

**Testes:** `apps/api/test/bootstrap.test.ts` — o contexto sobe e desce sem handle pendurado; variável obrigatória ausente derruba o start com mensagem nomeando a variável.

**Pronto quando:** `pnpm --filter api start` sobe sem servir HTTP e um `SIGTERM` encerra o processo com código 0 depois de rodar os hooks de shutdown.

### F4.1 — Harness de resiliência e `FakeLlmExecutor`

**Entrega:** o instrumento que as etapas seguintes usam para se provar: um executor de mentira com modos de falha e um harness que semeia banco, roda cenário e grava evidência em arquivo — sem LLM e sem token real.

**Arquivos:** `apps/api/src/correcoes/fake-llm-executor.ts`, `apps/api/test/resiliencia/harness.ts`, `scripts/resiliencia/README.md`

**Tarefas**

- [ ] Criar `FakeLlmExecutor` implementando a interface `LlmExecutor` da F3, com modos configuráveis: sucesso, falha, timeout e saída de token inválido — é **test double desta fase**, coisa distinta do seam `FC_PAYLOAD_CMD` da F2 (que é carga do entrypoint, não implementação da interface); selecionado por injeção no módulo de teste, sem nenhum `if (teste)` no código de produção
- [ ] Harness de cenário: semeia run, submissões e `config`, sobe o contexto da F4.0 e devolve o estado do banco para asserção, sem truncate automático ao final (o cenário fica inspecionável)
- [ ] Convenção de evidência em `scripts/resiliencia/out/<cenario>.log`: estados finais, `retry_n` por submissão e recursos Docker remanescentes
- [ ] Registrar no `README.md` do diretório qual etapa escreve cada cenário: R3 na F4.5, R2 na F4.6, R4 na F4.7, R1 na F4.8

**Testes:** `fake-llm-executor.test.ts` — cada um dos quatro modos devolve o desfecho combinado (dossiê válido, exit code de falha, estouro de tempo, stderr de token inválido) sem tocar em Docker nem em rede.

**Pronto quando:** `pnpm test` verde nos quatro modos e o harness semeia e lê o banco de teste sem exigir token real nem imagem do runner.

### F4.2 — pg-boss no ciclo de vida da API

**Entrega:** a fila existe dentro da API, com schema próprio, start e shutdown limpos sobre o `AppModule` da F4.0, e o cron do janitor passa a ser dela.

**Arquivos:** `apps/api/src/fila/fila.module.ts`, `apps/api/src/fila/fila.service.ts`, `apps/api/src/fila/filas.ts`

**Tarefas**

- [ ] Adicionar `pg-boss` a `apps/api` e instanciar o boss com a `DATABASE_URL` do `.env`, em **schema dedicado** (ex.: `pgboss`), para não colidir com as migrations do Prisma
- [ ] Iniciar em `onModuleInit` e encerrar em `onModuleDestroy` com `boss.stop({ wait: true })` — job em andamento termina (§12)
- [ ] Declarar as filas em um único módulo de constantes: `correcao`, `retomada-pausa`, `janitor`
- [ ] Configurar todo job com timeout explícito e `retryLimit: 0` (D1)
- [ ] Registrar o schedule do `janitor` no cron do pg-boss (§12), chamando a mesma função da F2 (F2.7, D3) e aposentando a entrada CLI provisória; todo log de fila e worker sai pelo logger da F4.0, com `submissao_id` e `correcao_id`

**Testes:** integração contra o Postgres do compose — job enviado e consumido; `boss.stop({ wait: true })` espera o handler terminar em vez de cortá-lo.

**Pronto quando:** a listagem de schedules do boss inclui `janitor`, e derrubar a API com um job em execução deixa o job concluído (não `expired`).

### F4.3 — Máquina de estados persistida

**Entrega:** toda mudança de status de submissão passa por um único ponto, que recusa transição fora do §6 e grava o evento na mesma transação.

**Arquivos:** `packages/shared/src/dominio/estados.ts`, `packages/shared/src/dominio/estados.test.ts`, `apps/api/src/submissoes/maquina-estados.service.ts`

**Tarefas**

- [ ] Acrescentar ao módulo `packages/shared/src/dominio/estados.ts` **criado na F1** a tabela de transições legais do §6 **como dado**, uma entrada por linha, incluindo as duas linhas coringa (`qualquer não-terminal → cancelada` e `→ substituida`), reutilizando `StatusSubmissao` e `STATUS_TERMINAIS`
- [ ] **Não** redeclarar o enum nem criar segunda função de complemento: `estaAtiva` é a da F1 e continua sendo a única (§5, Apêndice B v1.3 item 1)
- [ ] Expor `podeTransicionar(de, para)` derivado da tabela; a expansão das coringas é calculada a partir de `estaAtiva`, não escrita à mão
- [ ] Implementar `transicionar(submissaoId, para, { motivo, payload })`: em uma única transação Prisma, reler o status com `SELECT … FOR UPDATE`, validar, atualizar `status`/`status_detalhe` e inserir a linha em `eventos` (append-only, §12); e `transicionarSeEstiverEm(submissaoId, de[], para, …)`, que retorna `false` sem lançar — é a primitiva de idempotência dos handlers
- [ ] Erro de domínio `TransicaoIlegalError` tipado (com `de`, `para`, `submissao_id`), nunca `throw new Error` (skill `implementar-fase`)
- [ ] Emitir notificação em `sem_skill` e `erro` (§6)
- [ ] Provar por `grep` que não existe nenhum `submissoes.update` com `status` fora deste serviço

**Testes:** a tabela do §6 vira tabela de teste, transição por transição.

**Pronto quando:** `pnpm test` verde com um caso por transição legal e a varredura do produto cartesiano recusando todo o resto.

### F4.4 — Enfileiramento e worker da correção

**Entrega:** submissão em `na_fila` vira job pg-boss, e o worker a leva a `corrigindo` com claim idempotente, respeitando `max_paralelo` do run.

**Arquivos:** `apps/api/src/correcoes/correcao.worker.ts`, `apps/api/src/correcoes/enfileiramento.service.ts`

**Tarefas**

- [ ] Enfileirar o job `correcao` junto da transição para `na_fila`, conforme D2, com payload mínimo (`submissao_id`) — nada de dados de domínio duplicados no payload
- [ ] Registrar o worker com concorrência igual ao `max_paralelo` do run ativo (default 2, teto 4, §8); como só há 1 run ativo por vez (§10.21), a troca de run re-registra o worker sem sobreposição
- [ ] Claim idempotente no início do handler: `transicionarSeEstiverEm(['na_fila'], 'corrigindo')`; se retornar `false` (cancelada, substituída, já em voo), completar o job sem efeito e gravar evento `job.ignorado`
- [ ] Criar a linha em `correcoes` (`status: rodando`, `modelo` do run, `retry_n` calculado) na mesma transação do claim
- [ ] Delegar a execução ao Job Controller/`LlmExecutor` (F2/F3); o jitter de start (§8) é do Job Controller e **não** é reimplementado aqui
- [ ] Ao fim com dossiê válido, aplicar a regra de destino do §6: `aguardando_revisao` se política = `todas`, ou veredito `reprovado` com política `so_reprovadas`, ou `duvidas ≠ ∅`, ou `veredito = inconclusivo`, ou `gatilhos ≠ ∅` (lido de `correcoes.gatilhos`, vazio enquanto a F7 não existir); senão `pronta_envio` (§2.7)

**Testes:** handler rodado duas vezes com o mesmo payload não cria duas `correcoes` nem duas transições; submissão cancelada antes do claim → handler no-op; regra de destino cobrindo os cinco termos do `OR` isoladamente.

**Pronto quando:** com o `FakeLlmExecutor` da F4.1 em modo sucesso, 4 jobs enfileirados com `max_paralelo = 2` nunca deixam mais de 2 submissões em `corrigindo` ao mesmo tempo (consulta ao banco durante a execução).

### F4.5 — Retry, timeout e `erro`

**Entrega:** falha e timeout consomem retry até 3 execuções totais; a terceira leva a `erro` com transcript preservado.

**Arquivos:** `apps/api/src/correcoes/retry.service.ts`, `apps/api/src/correcoes/timeout.ts`

**Tarefas**

- [ ] Calcular o timeout efetivo por submissão pela fórmula única `skills_map.timeout_s ?? config.timeout_job_padrao_s` (semeado com 1500 na F1, §8/§10.9) — **nenhum literal `1500` no código** do Job Controller ou do worker
- [ ] Definir `expireInSeconds` do job como timeout efetivo + margem de teardown (D3)
- [ ] Derivar `retry_n` de `count(correcoes WHERE submissao_id = ? AND status <> 'nao_executada')` posteriores ao último marco de reprocessamento (D7) — nunca de contador mutável
- [ ] Ao terminar com falha ou timeout: marcar a correção `falhou`/`timeout` com `erro_resumo`; se `retry_n < 3`, transicionar `corrigindo → na_fila` e reenfileirar; se `retry_n = 3`, transicionar `corrigindo → erro` com `status_detalhe` e notificação (§6)
- [ ] Escrever o cenário R3 (`scripts/resiliencia/r3-tres-falhas.ts`) na convenção da F4.1: `FakeLlmExecutor` em modo falha, três execuções, evidência gravada
- [ ] Garantir que o retry corretivo do dossiê (§7, F3) **não** cria segunda linha em `correcoes` e portanto não move `retry_n`; e que nenhum caminho de falha apaga job dir, transcript ou linha de `correcoes` (§11)

**Testes:** 3 falhas seguidas → `erro` com 3 linhas em `correcoes` e `transcript_path` preenchido nas 3; sequência falha → `nao_executada` → falha → falha termina em `erro` só na 4ª execução, provando que a `nao_executada` não contou.

**Pronto quando:** o cenário R3 rodando com o `FakeLlmExecutor` em modo falha termina em `erro` na 3ª execução, com 3 linhas em `correcoes` e `transcript_path` preenchido nas 3, e a sequência com `nao_executada` no meio só chega a `erro` na 4ª execução.

### F4.6 — Pausa global, `nao_executada` e retomada

**Entrega:** limite de plano e credencial inválida pausam o sistema sozinhos, sem consumir retry, com notificação específica e retomada escalonada.

**Arquivos:** `apps/api/src/sistema/pausa.service.ts`, `apps/api/src/correcoes/classifica-falha-cli.ts`, `scripts/pausa-global.ts`

**Tarefas**

- [ ] Ler e escrever `config.pausa_global` no **formato objeto semeado pela F1** — `{ ativa, motivo, desde, tentativas }`, com `motivo ∈ {manual, limite_plano, credencial, disco}` — nunca como booleano; o motivo `disco` é escrito pelo janitor da F2 (F2.7, D9) e quem obedece é este handler
- [ ] `PausaService.pausar(motivo)` / `retomar(origem)` — manual e automática pelo mesmo caminho, ambas gravando evento e notificação (§12)
- [ ] Handler checa a pausa antes de qualquer efeito: se ativa, cria correção `nao_executada`, devolve a submissão a `na_fila` sem consumir retry e completa o job (§6, §10.10); a fila também é pausada no pg-boss para não girar em falso, mas a autoridade é a checagem do handler (D4)
- [ ] `classificaFalhaCli(exitCode, stderr, transcriptTail)` puro, devolvendo `limite_plano | credencial | outra`, com fixtures de saída real em `apps/api/test/fixtures/cli/`; `outra` é o padrão conservador (consome retry normalmente)
- [ ] Notificação por motivo: limite → "retomada automática em N min"; credencial → "rode `claude setup-token` e atualize o `.env`" (§10.11)
- [ ] Job singleton `retomada-pausa` com os intervalos de D5, que só retoma pausa **automática**; pausa manual sai só por ação humana
- [ ] Expor a pausa manual por `scripts/pausa-global.ts on|off` enquanto não há endpoint (F5) nem botão (F6)
- [ ] Escrever o cenário R2 (`scripts/resiliencia/r2-token-forjado.ts`) com `CLAUDE_CODE_OAUTH_TOKEN` forjado **de verdade** no runner, para capturar a saída real do CLI e transformá-la na fixture do classificador

**Testes:** pausa ativa → correção `nao_executada` e `retry_n` inalterado; classificador com as fixtures; retomada automática não desfaz pausa manual; job em andamento no momento da pausa termina.

**Pronto quando:** `pnpm tsx scripts/resiliencia/r2-token-forjado.ts` deixa `config.pausa_global.ativa = true` com `motivo = "credencial"`, correção `nao_executada` e `retry_n` inalterado, e o teste de retomada com relógio injetado não desfaz pausa manual.

### F4.7 — Cancelamento, substituição e ciclo de vida do run

**Entrega:** cancelar e substituir funcionam inclusive com o runner em voo, o banco impede duas submissões ativas do mesmo aluno no mesmo desafio, e um run sai de `ativo` em vez de prender o sistema em um único lote para sempre.

**Arquivos:** `apps/api/src/submissoes/cancelamento.service.ts`, `apps/api/src/submissoes/substituicao.service.ts`, `apps/api/src/runs/runs.service.ts`

**Tarefas**

- [ ] `cancelar(submissaoId)`: transicionar para `cancelada` (a partir de qualquer não-terminal); se estava `corrigindo`, chamar o kill + teardown do Job Controller por `fc.job=<id>` **depois** do commit, registrar o resultado em `eventos` e marcar a correção em voo como `falhou` com `erro_resumo` explícito (D6); nada é enviado
- [ ] `substituir`: com submissão ativa de (aluno_email, projeto, fase), na mesma transação transicionar a anterior para `substituida` e inserir a nova em `recebida`; kill + teardown depois do commit se a anterior estava `corrigindo` (§10.5)
- [ ] Tratar violação do índice único parcial (SQLSTATE 23505) como corrida: repetir a transação uma vez e, persistindo, devolver `SubmissaoAtivaDuplicadaError` tipado
- [ ] Invariante de 1 run ativo (§10.21) conforme D8, com erro de domínio `RunAtivoExistenteError`
- [ ] Transições de `runs.status` conforme a tabela do §6.1: `finalizado` **automático** quando toda submissão do lote está em estado terminal do §6 (`enviada`, `cancelada`, `substituida`), avaliado ao fim de cada transição de submissão; `cancelado`, `pausado` e retomado por ação humana, cada um gravando evento
- [ ] Submissão parada em `erro`, `sem_skill` ou `link_invalido` é **ativa** (§5) e mantém o run aberto: a saída é resolvê-la (reprocessar/enviar) ou cancelar o run — não existe finalização "por desistência" silenciosa
- [ ] Run `pausado` não recebe job novo e sai da invariante do §10.21 (o índice parcial só olha `ativo`), então `retomar` recusa com `RunAtivoExistenteError` se já houver outro run `ativo`
- [ ] Escrever o cenário R4 (`scripts/resiliencia/r4-substituicao.ts`) na convenção da F4.1: entrega duplicada chegando com a anterior em `corrigindo`, evidência do runner morto e da anterior em `substituida`
- [ ] Com o run anterior em `finalizado` ou `cancelado`, a criação de um novo run passa a ser aceita — a invariante é sobre `ativo`, não sobre a vida do sistema; a superfície humana disso é REST (F5) e botão (F6), aqui existe só o serviço de domínio que as duas chamam

**Testes:** substituição durante `corrigindo` → anterior `substituida`, runner morto, nenhuma devolutiva enviada; dois inserts concorrentes do mesmo trio → um sobrevive e o outro recebe erro de domínio; mesmo aluno com dois desafios diferentes ativos ao mesmo tempo é aceito (§10.20); segundo run ativo recusado; lote inteiro terminal vira `finalizado` e libera o próximo run.

**Pronto quando:** o teste de integração desta etapa passa: substituição durante `corrigindo` mata o runner (`docker ps` sem `fc-job-<id>` da anterior), o segundo run com um ativo é recusado, e um run com todas as submissões terminais vira `finalizado` deixando a criação do próximo passar.

### F4.8 — Recuperação pós-reinício e reprocessar

**Entrega:** um restart no meio de um run não deixa submissão pendurada, e o humano tem como devolver uma submissão travada para a fila.

**Arquivos:** `apps/api/src/sistema/recuperacao.service.ts`, `apps/api/src/submissoes/reprocessar.service.ts`

**Tarefas**

- [ ] No boot, antes de iniciar o worker: **chamar a rotina de recuperação entregue pela F2** (F2.8 — marca cada correção `rodando` como `falhou` com `erro_resumo` "órfã pós-reinício" e aborta os recursos Docker do job) e, para cada correção que ela marcou, transicionar a submissão `corrigindo → na_fila` **consumindo retry** (§10.12). A F4 não reimplementa a marcação nem duplica o teardown
- [ ] Submissão em `corrigindo` sem correção `rodando` correspondente volta pelo mesmo caminho; submissão em `na_fila` sem job ativo é reenfileirada (fecha o gap de D2 e cobre §10.28)
- [ ] Ordem obrigatória no boot: rotina da F2 → transições de estado desta fase → start do worker
- [ ] `reprocessar(submissaoId)` a partir de `aguardando_revisao | erro | sem_skill`: grava o marco `submissao.reprocessada` em `eventos` (D7), transiciona para `na_fila` e reenfileira; em `sem_skill`, recusa enquanto `skill_slug` estiver nulo (§6)
- [ ] Escrever o cenário R1 (`scripts/resiliencia/r1-kill-worker.ts`): mata o processo com correção em voo, reinicia e grava a evidência na convenção da F4.1

**Testes:** processo morto com uma correção `rodando` → após restart, correção `falhou`, submissão `na_fila`, retry consumido, sem loop infinito; três reboots seguidos terminam em `erro`; reprocessar após `erro` libera 3 novas execuções.

**Pronto quando:** `pnpm tsx scripts/resiliencia/r1-kill-worker.ts` grava evidência com a correção `falhou` ("órfã pós-reinício"), a submissão em `na_fila` e `retry_n = 1`; e, como consolidação da fase, os quatro cenários R1–R4 rodam do zero contra banco limpo e os aceites A1–A8 ficam verdes.

## Edge cases do §10 cobertos aqui

| # | Caso | Como esta fase trata | Onde é verificado |
|---|---|---|---|
| 5 | Nova entrega com a anterior ainda ativa | Substituição transacional + kill/teardown do runner em voo (F4.7) | A4 |
| 7 | Dossiê ausente/JSON inválido | Só a contagem: a correção que falhou após o retry corretivo da F3 consome retry (F4.5) | Teste de `retry_n` |
| 9 | Timeout do job | Timeout efetivo `skills_map.timeout_s ?? config.timeout_job_padrao_s`, kill pelo Job Controller, re-execução até 3 (F4.5) | A3 |
| 10 | Limite do plano / rate limit | Classificador do erro do CLI → pausa automática + `nao_executada` + retomada escalonada (F4.6) | A2 |
| 11 | Token expirado/revogado | Mesmo caminho do 10, com notificação específica (F4.6) | A2 |
| 12 | Reboot/queda no meio | Rotina da F2 marca a correção órfã `falhou`; a F4 devolve a submissão consumindo retry (F4.8) | A1 |
| 20 | Mesmo aluno, 2 desafios ao mesmo tempo | O índice parcial inclui projeto+fase; nada bloqueia (F4.7) | Teste de dedupe |
| 21 | Tentativa de 2º run com um ativo | Invariante no domínio/banco, erro tipado; run que sai de `ativo` libera o próximo (F4.7) | A5 e A6 |
| 28 | WSL suspende no meio | Cai no caso 12; a reconciliação do boot reenfileira (F4.8) | A1 |

## Critérios de aceite

| # | Critério | Como provar | Evidência esperada |
|---|---|---|---|
| A1 | Matar o worker no meio de uma correção não perde a submissão | `pnpm tsx scripts/resiliencia/r1-kill-worker.ts` | Log com correção `falhou` ("órfã pós-reinício"), submissão em `na_fila`, `retry_n` = 1, zero submissão em `corrigindo` |
| A2 | Token inválido forjado → pausa + notificação + retomada sem consumir retry | `pnpm tsx scripts/resiliencia/r2-token-forjado.ts` | `config.pausa_global` com `ativa = true` e `motivo = "credencial"` (objeto, não booleano), notificação com o texto do §10.11, correção `nao_executada`, `retry_n` inalterado; após corrigir o token e retomar, a mesma submissão conclui |
| A3 | 3 falhas seguidas → `erro` com transcript preservado | `pnpm test` (cenário R3) | 3 linhas em `correcoes` com `transcript_path` preenchido, submissão em `erro`, job dirs intactos |
| A4 | Submissão duplicada substitui inclusive durante `corrigindo` | `pnpm test` (cenário R4) | Anterior em `substituida`, `docker ps` sem `fc-job-<id>` da anterior, nova em `na_fila`, nenhuma devolutiva enviada |
| A5 | Segundo run ativo é recusado | `pnpm test` | `RunAtivoExistenteError` e apenas 1 linha em `runs` com `status = ativo` |
| A6 | Run finalizado libera o próximo | `pnpm test` (cenário de ciclo de vida do run) | Com todas as submissões do lote em estado terminal, o run vira `finalizado` sozinho; a criação do run seguinte é aceita, sem `RunAtivoExistenteError` |
| A7 | A tabela do §6 está coberta transição por transição | `pnpm test` | 33 pares legais aceitos (15 nominais + 18 gerados pelas duas coringas) e os 111 restantes do produto 12×12 recusados |
| A8 | Definição de pronto do repositório | `pnpm lint`, `pnpm typecheck`, `pnpm test` | Os três verdes |

- [ ] A1
- [ ] A2
- [ ] A3
- [ ] A4
- [ ] A5
- [ ] A6
- [ ] A7
- [ ] A8

## Testes que nascem nesta fase

- **Tabela de transições (§6)** — unidade pura em `packages/shared`: um caso por transição legal, mais a varredura do produto cartesiano provando que tudo fora da tabela é recusado. É o teste que trava a regra dura 3 do CLAUDE.md.
- **Complemento de `estaAtiva` preservado** — a F4 acrescenta transições ao módulo da F1 sem redeclarar o enum nem criar segunda função: status hipotético novo continua nascendo ativo e entra no produto cartesiano do teste acima.
- **Bootstrap e `FakeLlmExecutor`** — o contexto de aplicação sobe e desce sem handle pendurado e variável obrigatória ausente derruba o start nomeando a variável; os quatro modos do executor (sucesso, falha, timeout, token inválido) devolvem desfechos distintos sem Docker nem rede.
- **Idempotência do handler** — mesma mensagem processada duas vezes não duplica `correcoes` nem transição; claim sobre submissão já cancelada é no-op.
- **Contagem de retry** — 3 execuções terminam em `erro`; `nao_executada` no meio não conta; retry corretivo do dossiê não conta; reprocessar reinicia a contagem.
- **Concorrência** — `max_paralelo` respeitado com o `FakeLlmExecutor`.
- **Ciclo de vida do run** — lote inteiro terminal vira `finalizado`; run `pausado` não recebe job; com o anterior finalizado, o próximo run é aceito.
- **Pausa e classificador de falha do CLI** — fixtures reais (token inválido) e sintéticas (rate limit), com saída desconhecida caindo em `outra`; `nao_executada` sem consumo de retry; job em voo termina; retomada automática não desfaz pausa manual; backoff com relógio injetado (sem `sleep`).
- **Substituição e dedupe** — durante `corrigindo`, com kill; corrida de dois inserts; dois desafios do mesmo aluno convivendo; segundo run recusado.
- **Recuperação no boot** — órfã marcada, retry consumido, sem loop infinito; `na_fila` sem job é reenfileirada.
- **Regra de destino pós-correção** — os cinco termos do `OR` do §6 isolados, com política `nenhuma` provando que dúvida e gatilho ainda mandam para revisão (§2.7).

## Riscos e armadilhas

- **O classificador de erro do CLI é o ponto frágil da fase.** As strings do CLI mudam sem aviso, e um rate limit classificado como `outra` queima as 3 execuções da submissão em minutos. Sinal de alerta: várias submissões em `erro` com `erro_resumo` parecido no mesmo intervalo. Mitigação: token inválido é forjável e vira fixture real; rate limit não é — a fixture é sintética e fica marcada como tal.
- **Retomada automática por credencial retoma e falha de novo** até alguém atualizar o `.env`. É o comportamento que o §10.11 pede; o teto do backoff (D5) é o que evita loop apertado, e a notificação é o que resolve de fato.
- **`boss.stop()` sem `wait: true`** transforma todo shutdown em órfão pós-reinício, consumindo retry à toa. É o erro mais fácil de cometer nesta fase.
- **Handler não idempotente envenena a contagem de retry**: uma execução contada duas vezes leva a `erro` com 2 execuções reais. Por isso o claim vem antes de qualquer efeito.
- **Prisma e pg-boss no mesmo banco**: sem schema dedicado, uma `migrate` pode encostar nas tabelas do boss. Isolar por schema desde a primeira linha.
- **`config.pausa_global` é objeto, não booleano** (F1): o janitor da F2 também o escreve. Ler como booleano dá pausa "sempre ativa" (objeto é truthy) ou nunca ativa — os dois falham em silêncio.
- **Run que nunca finaliza**: submissão travada em `erro`, `sem_skill` ou `link_invalido` é ativa (§5) e segura o lote aberto, bloqueando o próximo run pelo §10.21. Sinal de alerta: run `ativo` há dias com zero submissão em `na_fila`/`corrigindo`.
- **Testes de tempo viram flaky.** Relógio injetável em timeout e backoff; a skill proíbe `sleep` e dependência de ordem. E suspensão do WSL no meio de um teste de backoff dá falso positivo/negativo (§10.28) — rodar os cenários com a suspensão desativada.
- **Node fora do PATH em shell não-interativo** (STATUS.md): o worker dispara processos do Job Controller — caminho absoluto ou `corepack` no PATH, não `node` puro.
- **Risco §15 "limite do plano estrangula o volume"**: esta fase é a mitigação, não a medição. O número de consumo por correção vem do output JSON do CLI (F3) e embasa a conversa de API key.

## O que NÃO entra nesta fase

- Camada HTTP (controllers, DTOs, exception filter HTTP, serialização de `BigInt`), endpoints de pausar, cancelar, reprocessar e de ciclo de vida do run, e SSE (`submissao.updated`, `run.updated`, `notificacao.created`, `sistema.pausa`) → **F5**, sobre o `AppModule` que a F4.0 entrega; nesta fase a fonte é a tabela `eventos` e não há emissor in-process
- Serviço de validação de repo, resolução de skill e devolutiva de `link_invalido` → **F5**; a F4 entrega as transições `validando → …` que esse serviço chama
- Qualquer tela, botões de run e banner de gatilho agregado → **F6**
- Gatilhos programáticos (tamanho, `pg_trgm`, coerências, duração anômala) → **F7**; a F4 apenas lê `correcoes.gatilhos`
- Cron de backup diário (§12) e calibração dos limiares (backoff, retenções) → **F7**
- Driver de envio e envio automático; a transição `pronta_envio → enviada` existe na máquina, o driver `fc_platform` → **F9**

## Impacto em fases seguintes

A preencher no encerramento da fase.

| O que mudou aqui | Fase afetada | O que foi atualizado lá |
|---|---|---|

## Registro de execução

A preencher durante a fase.

- **Iniciada em:** AAAA-MM-DD
- **Concluída em:** AAAA-MM-DD
- **Decisões tomadas:**
- **Divergências do plano:**
- **Evidência dos aceites:**
