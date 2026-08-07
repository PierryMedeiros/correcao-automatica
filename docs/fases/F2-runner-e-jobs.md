# F2 — Runner e execução de jobs

> **Status:** ⬜ não iniciada
> **Estimativa:** 3–4 dias úteis (plan §13)
> **Depende de:** F0 (spikes S1, S2 e S3) · F1 (banco)
> **Destrava:** F3 (o container onde o agente roda) · F4 (kill, teardown e recuperação de órfãos)
> **Seções do plano:** §8 (runner, inteiro) · §9.2 passos 3, 4 e 6 · §11 (retenção de job dirs) · §12 (janitor, logs) · §10.9, §10.12–15, §10.17–20, §10.28

## Objetivo

Ao fim desta fase o sistema executa uma correção sozinho, sem LLM: cria o diretório do job, a network
isolada e o container runner com limites, labels e mounts; acompanha até o fim ou o timeout; recolhe
os artefatos; persiste a correção; e derruba tudo o que criou — mesmo em falha, kill ou reboot. Falta
só a carga: a invocação do agente, que é a F3. É a fase que transforma o princípio "isolamento por
construção" (§2.4) e "nada destrutivo global" (§2.5) em código executável.

## Pré-condições

- [ ] F1 marcada ✅ em `docs/fases/README.md`, com as tabelas `correcoes`, `submissoes`, `skills_map`,
      `config` e `eventos` migradas (`pnpm db:migrate` de banco zerado sai 0)
- [ ] Spikes S2 (netns) e S3 (compose sem portas + network externa) verdes e documentados em
      `docs/spikes.md` — esta fase é a industrialização exata da topologia que eles provaram
- [ ] Spike S1 verde: a imagem mínima com o CLI autenticou por `CLAUDE_CODE_OAUTH_TOKEN`
      (a flag de permissão decidida ali só é usada na F3, mas o Dockerfile da F2.1 já instala o CLI)
- [ ] `.env` preenchido com `SKILLS_DIR`, `JOBS_DIR`, `RUNNER_IMAGE` e `CLAUDE_CODE_OAUTH_TOKEN`
      (pendência humana §17.3) — conferir com `test -d "$SKILLS_DIR"` e `test -d "$JOBS_DIR"`
- [ ] `$SKILLS_DIR` tem ao menos uma skill `corrige-*` real para montar `:ro` no teste
- [ ] Docker Engine acessível sem sudo pelo usuário do host e gid do socket conhecido:
      `stat -c %g /var/run/docker.sock`
- [ ] Disco com ≥ 15 GB livres (abaixo disso o janitor já nasce alertando, §10.19): `df -h /`
- [ ] §17.4 aplicado — `nproc` dentro do WSL devolve ≥ 6 e a suspensão está desativada; o aceite de
      4 jobs fake em paralelo (A2) pressupõe isso

## Decisões do plano que esta fase materializa

| Decisão | Onde está | Consequência prática nesta fase |
|---|---|---|
| Network externa criada **antes** do runner (elimina a corrida) | §8, Apêndice B (06/08) item 1 | A ordem da F2.4 é obrigatória: network → runner → conecta → start |
| Quem clona e invoca é o entrypoint; o controller só prepara arquivos antes do `docker run` | §9.2 passos 3–4, Apêndice B (06/08) item 5 | F2.2 é do entrypoint, F2.3/F2.4 são do controller — não misturar responsabilidade |
| Teardown em 3 camadas, sempre executado (inclusive em timeout/kill) | §8 | F2.6 roda a camada 2 em `finally`; a camada 3 é o janitor (F2.7) |
| Retry corretivo do dossiê acontece com o runner **ainda vivo** | §7, Apêndice B (06/08) item 6 | O entrypoint não encerra o container quando a carga retorna (F2.2, D10); F2.5 detecta o fim pelo marcador e deixa o ponto de extensão entre coleta e teardown, pronto para a F3 |
| Job dir órfão × referenciado são duas classes de retenção | §11, §12, Apêndice B v1.3 item 3 | O janitor consulta `correcoes` antes de apagar; dir de correção `falhou` fica 14 dias |
| Nada destrutivo global; limpeza sempre por label/prefixo | §2.5, §12, regra dura 1 | Todo `docker create`/`network create` leva `fc.job=<id>`; janitor filtra por label |
| Limites do runner e jitter de start | §8 | F2.4 aplica `--cpus 2 --memory 2.5g` e jitter de 5–15s; o teto de paralelismo é knob do run (F4) |
| Timeout efetivo = `skills_map.timeout_s ?? config.timeout_job_padrao_s` | §5, §10.9 | F2.5 lê o override da skill e o default de `config`, ambos gravados pela F1 — nenhum literal de timeout no código |
| Log do entrypoint vai para o job dir | §12 | F2.2 escreve `runner.log` dentro de `/workspace` |
| Skill montada `:ro` a partir de `$SKILLS_DIR`, sem cópia nem symlink | §4, §8, Apêndice B v1.3 item 6 | F2.4 monta `$SKILLS_DIR/<skill_slug>:/workspace/skill:ro` e aborta se o caminho não existir |

## Decisões a tomar nesta fase

| # | Pergunta em aberto | Opções | Recomendação |
|---|---|---|---|
| D1 | Qual é o `<id>` de `fc-job-<id>` e de `$JOBS_DIR/<id>`? O plano usa `<id>` sem dizer de quem | `correcoes.id` · id do job do pg-boss (só existe na F4) · id próprio de job | `correcoes.id`, com a linha criada em `rodando` **antes** do `docker run`: o §10.12 só detecta órfã se a correção `rodando` já estiver persistida, e o §11 só distingue dir órfão de referenciado se o nome do dir for a chave. Ordem: insert `correcoes` → cria job dir → network → runner |
| D2 | Onde mora o Job Controller, o gerador de override e o janitor, se o bootstrap do Nest só chega na F4.0? | `apps/api/src/` como TS puro, sem `main.ts`/DI · pacote próprio · esperar a F4 | `apps/api/src/jobs/` e `apps/api/src/janitor/` em TS puro (funções e classes sem decorator); a F4.0 os embrulha em provider quando o `AppModule` nascer. Alinhar com a decisão da F1 sobre onde mora o Prisma Client |
| D3 | O janitor é cron do pg-boss (§12), mas pg-boss só entra na F4 | função pura + entrada CLI (`pnpm janitor`) · antecipar pg-boss (viola regra dura 8) · cron temporário de terceiro | CLI: a F4 registra o cron chamando exatamente a mesma função. Registrar no STATUS.md como dívida com destino |
| D4 | Que carga o entrypoint executa sem o `claude -p`, que é entrega da F3? | seam `FC_PAYLOAD_CMD` (vazio na F2, preenchido pela F3 com a invocação headless) · imagem `banca-runner-fake` separada · escrever já a invocação (viola regra dura 8) | Seam. O controller escreve `job.json` no job dir com os dados do job (inclusive o comando canônico de compose); a F3 acrescenta a renderização de `prompt.txt` a partir de `runner/prompt-template.md` + `job.json` |
| D5 | O que a F2 faz com o `dossie.json`, se o schema é entrega da F3? | coletar como artefato (existe? é JSON parseável?) e deixar o ponto de extensão · antecipar o schema | Coletar + ponto de extensão entre coleta e teardown; a F3 pluga validador e retry corretivo (`docker exec` + `--resume`) ali, sem reordenar nada |
| D6 | `docker run -d` seguido de `network connect` deixa uma janela em que o runner roda fora da network do job | `docker create` → `network connect` → `docker start` · `run -d` + connect imediato · entrypoint espera sinal | create/connect/start: fecha a janela por construção, que é o espírito do Apêndice B (06/08) item 1. É mecanismo, não arquitetura — ao adotar, o §8 ganha uma linha e a troca vai para o Apêndice B |
| D7 | Como o fallback shallow (§10.17) chega ao backend, se `historico_nao_avaliado` é campo do dossiê (F3) e gatilho do backend (F7)? | marcador `clone.json` no job dir, escrito pelo entrypoint · variável de ambiente para o agente · o agente descobre sozinho | `clone.json`: o gatilho é do backend e não pode depender do que o agente escreveu no dossiê. A F3 faz o prompt refletir o marcador no campo do dossiê |
| D8 | §12 manda o janitor podar imagens dangling e cache de build, mas a regra dura 1 — e o guard `scripts/hooks/bloqueia-prune-docker.sh` — proíbem `docker image/builder prune` em qualquer forma, mesmo filtrada | remoção enumerada (`docker images -q -f dangling=true` + `docker rmi`) e cache de build fora do janitor, virando item do runbook (F7) · abrir exceção na regra dura 1 e no guard · não podar nada | Remoção enumerada + cache no runbook. É contradição real entre §12 e a regra dura 1: ao implementar, alinhar o texto do §12 e registrar no Apêndice B |
| D9 | O janitor da F2 já liga `config.pausa_global` no limiar de 5 GB (§10.19), se pausa global é entrega da F4? | sim, escreve o registro e a notificação; a F4 implementa quem obedece · só loga, e a F4 faz tudo | Escrever o registro: o §12 dá o monitoramento de disco ao janitor, e `pausa_global` é uma linha em `config` (tabela da F1). É **objeto, nunca booleano** — `{ ativa, motivo, desde, tentativas }`, com `motivo = "disco"` neste caminho. Quem obedece ao registro é a F4 |
| D10 | O entrypoint pode encerrar quando a carga retorna? O §9.2 passo 4 descreve o entrypoint invocando e saindo, mas o §7 exige `docker exec` + `claude --resume` no runner **ainda vivo** | (a) o entrypoint escreve o marcador `resultado.json` no job dir e permanece vivo até o sinal de encerramento do Job Controller · (b) o entrypoint sai e o controller detecta o fim pela saída do container — mata o retry corretivo por construção · (c) subir um segundo container para o retry, perdendo a sessão do `--resume` | (a). O fato já foi registrado na F0 D6 ("o entrypoint **não pode** encerrar quando o `claude -p` retorna"), e (b) torna o §7 inexequível. Consequência: o fim do job passa a ser detectado por marcador (F2.2, F2.5) e o teardown passa a sinalizar o encerramento (F2.6); o timeout e o `docker kill` continuam do lado do host. É contradição real entre §7 e §9.2 — ao adotar, as duas seções ganham uma linha e a mudança vai ao **Apêndice B antes de a F2 começar** |

## Etapas

### F2.0 — Harness de job fake

**Entrega:** o instrumento que executa N jobs fake fim a fim contra Docker de verdade — nasce primeiro porque é ele que prova o "Pronto quando" das etapas seguintes, e é a base do E2E da F7.

**Arquivos:** `scripts/job-fake/run.ts`, `scripts/job-fake/fixtures/compose-portas-fixas.yaml`, `scripts/job-fake/fixtures/repo-exemplo/`

**Tarefas**

- [ ] `pnpm job-fake --n <N>`: semeia submissões e correções de teste (`modelo = "fake"`), dispara o pipeline F2.3 → F2.6 com `FC_PAYLOAD_CMD` apontando para `payload.sh`. O comando nasce aqui como esqueleto e ganha capacidade a cada etapa que o pipeline avança — o relatório final só fica completo quando a F2.6 existir
- [ ] Fixture de repo restaurada como bare repo local e clonada por `file://` — mesma escolha dos golden repos (§14, Apêndice B v1.1)
- [ ] Fixture de compose com `ports: "8080:8080"` e `container_name:` fixo (§10.14, §10.15) mais um serviço que escuta direto na 8080 (§10.13)
- [ ] Flags `--dormir <s>` e `--timeout <s>` para provocar o aceite A3, e `--matar-no-meio` (SIGKILL no próprio processo com jobs em voo) para o A4
- [ ] Relatório final por job: exit code, presença do dossiê estático e recursos remanescentes (deve ser zero)

**Testes:** nenhum próprio — este harness é quem executa os aceites A1–A5.

**Pronto quando:** as fixtures existem e `pnpm job-fake --help` lista as flags; o fim a fim (`--n 4` saindo 0, quatro dossiês estáticos e zero recurso remanescente) é a consolidação dos aceites, provada depois da F2.6.

### F2.1 — Imagem do runner

**Entrega:** imagem `banca-runner:<tag>` reprodutível, com o CLI do Claude, Docker CLI + compose e as toolchains do §8, rodando como usuário não-root.

**Arquivos:** `runner/Dockerfile`, `runner/.dockerignore`, `scripts/build-runner.sh`

**Tarefas**

- [ ] Escrever `runner/Dockerfile` sobre `ubuntu:24.04` com versões pinadas: git, curl, jq, `docker-ce-cli` + `docker-compose-plugin`, Node 22 (NodeSource), Go (tarball), PHP 8.3 + Composer, Python 3.12 + pip (§8)
- [ ] Instalar `@anthropic-ai/claude-code` global com versão fixada no Dockerfile
- [ ] Criar usuário `corrector` (uid 1000) no grupo `docker` criado com o gid recebido em `ARG DOCKER_GID`; **não** instalar sudo (§11)
- [ ] `scripts/build-runner.sh`: resolve o gid com `stat -c %g /var/run/docker.sock`, builda com a tag de `RUNNER_IMAGE` e falha alto se a variável não estiver no `.env`
- [ ] Declarar `ENTRYPOINT` apontando para o script da F2.2 e `WORKDIR /workspace`

**Testes:** nenhum de unidade — a verificação é o smoke da própria imagem (ver Pronto quando).

**Pronto quando:** `bash scripts/build-runner.sh` sai 0 e `docker run --rm -v /var/run/docker.sock:/var/run/docker.sock $RUNNER_IMAGE bash -lc 'id -un && docker ps -q && claude --version && go version && node -v && php -v && python3 -V'` responde tudo como `corrector`, sem `permission denied` no socket.

### F2.2 — Entrypoint: clone, checkout e seam da carga

**Entrega:** o runner, ao subir, deixa o repo do aluno pronto em `/workspace/repo` no SHA pinado, executa a carga do job, sinaliza o fim por marcador e **permanece vivo** até o Job Controller mandar encerrar, com log completo no job dir.

**Arquivos:** `runner/entrypoint.sh`, `scripts/job-fake/payload.sh`

**Tarefas**

- [ ] `set -euo pipefail`; ler `FC_JOB_ID` e os dados de `/workspace/job.json` (repo_url, commit_sha)
- [ ] Redirecionar stdout/stderr para `/workspace/runner.log` preservando o código de saída (§12)
- [ ] `git clone` completo com timeout de 120s; em estouro, refazer com `--depth 1` e escrever `/workspace/clone.json` com `{"shallow": true, "motivo": "timeout_120s"}` (§10.17, D7)
- [ ] `git checkout <commit_sha>`, com código de saída próprio quando o SHA não existe no clone
- [ ] `git submodule update --init --recursive` tolerante a falha, registrando a falha em `clone.json` (§10.18)
- [ ] Executar a carga em `FC_PAYLOAD_CMD` (D4); variável ausente = marcador com código próprio e mensagem explícita, sem encerrar o container
- [ ] Ao fim da carga, escrever `/workspace/resultado.json` com `exit_code`, `finished_at` e o motivo do encerramento — é **este marcador**, e não a saída do container, que sinaliza o fim do job (D10)
- [ ] **Não encerrar o container** depois do marcador: aguardar o sinal de encerramento do Job Controller (arquivo-sentinela `/workspace/encerrar` ou SIGTERM), para que o `docker exec` + `claude --resume` do §7 tenha runner vivo (F0 D6, D10). Falha do clone também escreve marcador e espera — quem derruba o runner é sempre o host
- [ ] Escrever `scripts/job-fake/payload.sh`: sobe o compose de exemplo com o comando canônico de `job.json`, faz um `curl` por hostname de serviço, escreve `dossie.json` estático e roda `docker compose -p fc-job-<id> down -v`

**Testes:** `tests/runner-entrypoint.test.ts` (integração, exige Docker) — clone de bare repo local via `file://`, checkout do SHA, fallback shallow forçado por timeout artificial, submodule quebrado tolerado, `resultado.json` escrito com o exit code da carga e container ainda `running` depois dele.

**Pronto quando:** o runner rodando contra um bare repo local deixa `/workspace/repo` no SHA pedido, `runner.log` completo no job dir, `resultado.json` com o exit code da carga e `docker inspect -f '{{.State.Status}}' fc-job-<id>` ainda respondendo `running` até o teardown; com `FC_CLONE_TIMEOUT_S=1` o `clone.json` aparece com `shallow: true`.

### F2.3 — Job dir e gerador de override noports

**Entrega:** dado um job, o sistema materializa `$JOBS_DIR/<correcao_id>/` com `job.json` e o override que neutraliza portas e nomes fixos e prende a stack do aluno na network do job.

**Arquivos:** `apps/api/src/jobs/job-dir.ts`, `apps/api/src/jobs/override-noports.ts`, `apps/api/src/jobs/override-noports.test.ts`

**Tarefas**

- [ ] `criarJobDir(correcaoId)`: cria `$JOBS_DIR/<id>/` com dono/permissão que o uid 1000 do runner consiga escrever; falha se o dir já existir
- [ ] Escrever `job.json`: aluno, projeto/fase, `skill_slug`, `repo_url`, `commit_sha`, timeout efetivo, `compose_project = fc-job-<id>` e o comando canônico de compose já montado com `-p` e os dois `-f`
- [ ] `gerarOverrideNoports(compose)`: função pura que remove `ports:` e `container_name:` de **todos** os serviços e aponta a network default para `fc-job-<id>_net` com `external: true` (§8, §10.14, §10.15)
- [ ] Tratar compose sem `networks:` declarada, com múltiplas networks e com serviços sem porta — o override nunca inventa serviço nem remove chave alheia
- [ ] Registrar em `job.json` quais serviços tinham `container_name:` fixo (§10.15 pede o registro; o campo equivalente do dossiê é do agente, F3)

**Testes:** `override-noports.test.ts` (unidade, §14) — fixture do compose real usado no S3 mais os três formatos acima; override idempotente; resultado sem `ports`/`container_name` e com network externa.

**Pronto quando:** `pnpm test` cobre os casos acima e `docker compose -p fc-job-999 -f <base> -f <override> config` sai 0, sem nenhum `ports:`/`container_name:` e com `external: true` na network default.

### F2.4 — Network do job e subida do runner (ordem obrigatória)

**Entrega:** o runner sobe já dentro da network do job, com os limites, labels, mounts e variáveis do §8.

**Arquivos:** `apps/api/src/jobs/docker.ts`, `apps/api/src/jobs/job-controller.ts`, `apps/api/src/jobs/job-controller.test.ts`

**Tarefas**

- [ ] Wrapper de Docker com `execFile` (nunca string de shell: URL de repo e nome de aluno são dado externo), timeout em toda chamada e log com `job_id`
- [ ] `docker network create fc-job-<id>_net --label fc.job=<id>` **antes** de qualquer container (§8, Apêndice B (06/08) item 1)
- [ ] `docker create --name fc-job-<id> --label fc.job=<id> --cpus 2 --memory 2.5g` com os mounts do §8 (job dir → `/workspace`; `$SKILLS_DIR/<skill_slug>` → `/workspace/skill:ro`; `/var/run/docker.sock`) e env `CLAUDE_CODE_OAUTH_TOKEN`, `FC_JOB_ID`
- [ ] `docker network connect fc-job-<id>_net fc-job-<id>` e só então `docker start` (D6)
- [ ] Abortar antes de criar qualquer recurso se `$SKILLS_DIR/<skill_slug>` não existir — mount de caminho inexistente cria diretório vazio e a correção rodaria sem critérios
- [ ] Jitter aleatório de 5–15s antes do start, com relógio e aleatório injetáveis para o teste (§8)
- [ ] Nunca logar o valor de `CLAUDE_CODE_OAUTH_TOKEN` (regra dura 5)

**Testes:** `job-controller.test.ts` (unidade, wrapper Docker mockado) — a ordem das chamadas é network create → create → connect → start; skill ausente aborta antes de criar recurso; o token não aparece em nenhuma linha de log.

**Pronto quando:** com um job real, `docker inspect fc-job-<id> -f '{{json .NetworkSettings.Networks}}'` mostra bridge default **e** `fc-job-<id>_net`, e `docker inspect` confirma labels, `NanoCpus` e `Memory` — com o connect registrado antes do start.

### F2.5 — Acompanhamento, timeout e coleta de artefatos

**Entrega:** o controller detecta o fim do job pelo marcador do job dir (ou mata o runner no timeout), recolhe os artefatos e persiste a correção — com o runner ainda vivo quando o ponto de extensão da F3 roda.

**Arquivos:** `apps/api/src/jobs/job-controller.ts`, `apps/api/src/jobs/coleta.ts`, `apps/api/src/jobs/coleta.test.ts`

**Tarefas**

- [ ] Detectar o fim pelo marcador `/workspace/resultado.json` no job dir (D10) — o runner segue vivo por construção, então **`docker wait` não é o sinal de fim**; observar o arquivo por watcher ou polling curto, tolerando escrita parcial (só vale JSON completo)
- [ ] Calcular o timeout efetivo como `skills_map.timeout_s ?? config.timeout_job_padrao_s` (§5, §10.9) — nenhum literal de segundos no código; a contagem é do lado do host e vale mesmo se o marcador nunca aparecer
- [ ] No estouro: `docker kill` do runner, `correcoes.status = timeout`, `erro_resumo` com a duração e o limite aplicado
- [ ] Coletar `exit_code` (do marcador), `duracao_s`, `started_at`/`finished_at`, `runner.log`, `clone.json`, `resultado.json` e `dossie.json` (presente? JSON parseável?) — sem validar contra schema (D5)
- [ ] Persistir `transcript_path` apontando para o caminho canônico do job dir (o arquivo só passa a existir com a invocação do agente, F3)
- [ ] Deixar o ponto de extensão de validação **entre** coleta e teardown, com o runner ainda vivo, comentado com a referência ao §7 — é onde a F3 pluga validador e `--resume`
- [ ] Atualizar `correcoes` (`concluida`/`falhou`/`timeout`, exit_code, duração, `erro_resumo`); `dossie` fica nulo até a F3 validar
- [ ] Log estruturado (pino) com `job_id`/`submissao_id` em toda linha (§12)

**Testes:** `coleta.test.ts` (unidade) — job dir sem `dossie.json`, com JSON inválido e com JSON válido produzem os três resultados distintos; marcador ausente até o limite vira `timeout` e o job dir permanece; marcador escrito pela metade não é lido como fim.

**Pronto quando:** um job fake que dorme além do timeout é morto, a linha de `correcoes` fica `timeout`, e o job dir continua no disco com `runner.log` legível; um job fake normal fecha pelo marcador, com o runner ainda vivo no instante da coleta.

### F2.6 — Teardown em camadas

**Entrega:** nenhum recurso Docker do job sobrevive ao fim do job, qualquer que tenha sido o desfecho — e o job dir sobrevive sempre.

**Arquivos:** `apps/api/src/jobs/teardown.ts`, `apps/api/src/jobs/teardown.test.ts`

**Tarefas**

- [ ] `teardown(correcaoId)` idempotente, chamado em `finally` de todo caminho (sucesso, falha, timeout, kill, exceção)
- [ ] Sinalizar o encerramento ao runner antes de removê-lo — ele permanece vivo por construção (D10): escrever o arquivo-sentinela do job dir (ou `docker stop` com grace curto) e só então seguir a ordem abaixo; o `docker rm -f` continua como garantia de que nada fica de pé
- [ ] Ordem: `docker compose -p fc-job-<id> down -v --remove-orphans` → remover remanescentes por `--filter label=com.docker.compose.project=fc-job-<id>` → `docker rm -f fc-job-<id>` → desconectar e `docker network rm fc-job-<id>_net` → remover volumes por label (§8 camada 2)
- [ ] Cada passo tolera "não existe" sem falhar o teardown, e registra no log o que de fato removeu
- [ ] **Nunca** apagar o job dir (§11) — limpeza de disco é do janitor
- [ ] Expor `abortarJob(correcaoId)` = kill + teardown, primitiva que o cancelamento e a substituição da F4 vão consumir (§6)

**Testes:** `teardown.test.ts` (wrapper mockado) — idempotência (duas execuções, zero erro), ordem das camadas, e nenhuma chamada de remoção sem filtro de label do job.

**Pronto quando:** após qualquer desfecho, `docker ps -a --filter label=fc.job=<id>`, `docker network ls --filter label=fc.job=<id>` e `docker volume ls --filter label=fc.job=<id>` saem vazios e `$JOBS_DIR/<id>` continua lá.

### F2.7 — Janitor

**Entrega:** rotina que limpa o que escapou do teardown, aplica as duas classes de retenção do §11 e vigia o disco.

**Arquivos:** `apps/api/src/janitor/janitor.ts`, `apps/api/src/janitor/janitor.test.ts`, `scripts/janitor.ts`

**Tarefas**

- [ ] Remover containers/networks/volumes com label `fc.job=` ou prefixo `fc-job-` que não correspondam a uma correção em `rodando` (§12)
- [ ] Job dir **órfão** — nome sem linha correspondente em `correcoes` — sai no ciclo, sem olhar idade (§11)
- [ ] Job dir **referenciado**, inclusive por correção `falhou` ou `timeout`, sai só aos 14 dias (§11)
- [ ] Fail-safe: se a consulta a `correcoes` falhar, nenhum job dir é removido no ciclo e o erro é logado alto — apagar por engano é irreversível
- [ ] Imagens dangling por remoção enumerada (`docker images -q -f dangling=true` + `docker rmi`), nunca `prune` (regra dura 1, D8)
- [ ] Disco: alerta abaixo do limiar de alerta e, abaixo do limiar de pausa, escrever `config.pausa_global` como **objeto** — `{ ativa: true, motivo: "disco", desde: <agora>, tentativas: 0 }` (§10.19, D9), nunca como booleano e nunca sobrescrevendo uma pausa já ativa de outro motivo; limiares `disco_alerta_gb` (15) e `disco_pausa_gb` (5) lidos de `config` (F1)
- [ ] `pnpm janitor` roda um ciclo e imprime relatório do que removeu **e do que preservou**

**Testes:** `janitor.test.ts` — com job dirs falsos e linhas de `correcoes` semeadas: órfão sai; referenciado por `falhou` com 1 dia fica; referenciado com 15 dias sai; banco indisponível → zero remoção de job dir; limiar de disco rebaixado grava `pausa_global` com os quatro campos e `motivo: "disco"`.

**Pronto quando:** `pnpm janitor` sobre um estado montado à mão remove exatamente os órfãos, preserva os referenciados e imprime o relatório; suite acima verde.

### F2.8 — Recuperação de órfãos no boot

**Entrega:** reinício do processo host não deixa correção presa em `rodando` nem container de job vivo sem dono — e a rotina que faz isso é **a única** do sistema, exposta para a F4 chamar no boot.

**Arquivos:** `apps/api/src/jobs/recuperacao.ts`, `apps/api/src/jobs/recuperacao.test.ts`

**Tarefas**

- [ ] No start do processo, listar `correcoes` em `rodando`. No MVP há um único processo dono dos jobs, então **toda** correção `rodando` encontrada no boot é órfã por definição — inclusive as de container ainda vivo, que ninguém iria coletar
- [ ] Marcar como `falhou` com `erro_resumo = "órfã pós-reinício"` (§10.12) e rodar `abortarJob` para cada uma
- [ ] Expor a rotina como `recuperarCorrecoesOrfas()`, que devolve a lista do que marcou — `correcao_id`, `submissao_id` e o resultado do teardown de cada uma. **Esta é a única implementação da marcação do §10.12**: quem precisar dela chama, não reescreve
- [ ] Preservar job dir e `runner.log`: a correção existe, logo o dir é referenciado (§11)
- [ ] Registrar linha em `eventos` para a submissão de cada correção recuperada (auditoria, §12)
- [ ] Documentar no módulo e no retorno da função que re-enfileirar a submissão (`corrigindo → na_fila`, consumindo retry, §6/§10.12) é responsabilidade de quem chama — a F4 percorre a lista devolvida e faz a transição de cada item

**Testes:** `recuperacao.test.ts` — correção `rodando` sem container vira `falhou` com o motivo exato; correção `rodando` com container vivo tem o container morto e o teardown rodado; job dir intacto nos dois casos; a lista devolvida traz `correcao_id` e `submissao_id` de cada correção marcada, e a segunda execução devolve lista vazia (idempotência).

**Pronto quando:** matar o processo com 2 jobs em voo e reiniciar deixa as duas correções em `falhou` ("órfã pós-reinício"), zero recurso Docker com label do job e os dois job dirs intactos.


## Edge cases do §10 cobertos aqui

| # | Caso | Como esta fase trata | Onde é verificado |
|---|---|---|---|
| 9 | Timeout do job | Timeout efetivo `skills_map.timeout_s ?? config.timeout_job_padrao_s`, kill + teardown (F2.5, F2.6); a contagem de `retry_n` é da F4 | Aceite A3 |
| 12 | Reboot/queda no meio | `recuperarCorrecoesOrfas()` marca as correções `rodando` como `falhou` "órfã pós-reinício" e aborta os recursos (F2.8) — é a rotina que a F4 chama no boot antes de reenfileirar; o janitor limpa o resto (F2.7) | Aceite A4 |
| 13 | N correções do mesmo desafio de porta fixa | Netns próprio por runner (F2.4) | Aceite A2 |
| 14 | Compose do aluno publica portas fixas | Override remove `ports:` (F2.3) | Aceite A2 + `override-noports.test.ts` |
| 15 | `container_name:` fixo no compose | Override remove e `job.json` registra (F2.3) | `override-noports.test.ts` |
| 17 | Repo gigante / clone lento | Clone 120s → `--depth 1` + `clone.json` (F2.2); virar gatilho é F7 | `runner-entrypoint.test.ts` |
| 18 | Submodules quebrados | Clone tolera e registra em `clone.json` (F2.2) | `runner-entrypoint.test.ts` |
| 19 | Disco enchendo | Janitor alerta < 15 GB e, < 5 GB, grava `pausa_global` como objeto com `motivo: "disco"` (F2.7, D9); quem obedece ao registro é a F4 | Aceite A5 (limiar rebaixado) |
| 20 | Mesmo aluno, 2 desafios ao mesmo tempo | Independente por construção: job dir, network e container por `correcoes.id` (D1) | Aceite A2 |
| 28 | WSL suspende no meio | Cai no caso 12 (F2.8); o runbook que orienta desativar suspensão é da F7 | Aceite A4 |

## Critérios de aceite

**Esta seção é a fonte da verdade do "pronto" desta fase** (o §13 do plano aponta para cá).

| # | Critério | Como provar | Evidência esperada |
|---|---|---|---|
| A1 | Job fake roda fim a fim | `pnpm job-fake --n 1` | Exit 0; `dossie.json` e `runner.log` no job dir; linha em `correcoes` com `concluida` e `exit_code = 0`; zero recurso com label `fc.job=<id>` |
| A2 | 4 jobs fake em paralelo com o mesmo compose de portas fixas, sem colisão | `pnpm job-fake --n 4` | 4 dossiês escritos; nenhuma porta publicada no host para os jobs (`docker ps --format '{{.Ports}}'`); dentro de cada runner, `curl localhost:8080` e `curl http://<servico>:8080` respondem o próprio job (§10.13) |
| A3 | Timeout mata o runner e derruba tudo | `pnpm job-fake --n 1 --dormir 60 --timeout 10` | Correção em `timeout` com `erro_resumo`; runner morto em ~10s; zero recurso remanescente; job dir preservado |
| A4 | Kill do processo host no meio: sem órfão e sem perda | `pnpm job-fake --n 2 --matar-no-meio`, depois reiniciar o processo e rodar `pnpm janitor` | Zero container e zero network com prefixo `fc-job-`; duas correções `falhou` ("órfã pós-reinício"); os dois job dirs **continuam lá**. O §10.12 fala do processo que acompanha os jobs, que o §12 situa dentro da API; até a F5 esse processo é este harness — mesmo cenário |
| A5 | Retenção do §11 nas duas classes | Montar um job dir sem linha em `correcoes` e outro referenciado por correção `falhou` de 1 dia; `pnpm janitor` | O órfão é removido; o referenciado por `falhou` **permanece** — apagá-lo é o bug, não o aceite |
| A6 | Nenhuma criação Docker sem label do job | Durante A2: `docker ps -a --filter label=fc.job` e `docker network ls --filter label=fc.job` | Todo recurso criado pelo sistema aparece nos filtros; nenhum recurso do sistema fora deles (regra dura 2) |
| A7 | Repositório verde | `pnpm lint && pnpm typecheck && pnpm test && pnpm guards` | Saída verde nos quatro |

- [ ] A1
- [ ] A2
- [ ] A3
- [ ] A4
- [ ] A5
- [ ] A6
- [ ] A7

## Testes que nascem nesta fase

- `apps/api/src/jobs/override-noports.test.ts` — trava o contrato do override: `ports:` e `container_name:` somem de todos os serviços, a network default vira externa `fc-job-<id>_net`, nenhuma outra chave é tocada, e reaplicar o gerador dá o mesmo resultado.
- `apps/api/src/jobs/job-controller.test.ts` — trava a ordem network → create → connect → start (a corrida do Apêndice B (06/08) item 1), o abort quando a skill não existe e a ausência do token nos logs.
- `apps/api/src/jobs/coleta.test.ts` — trava os três desfechos de artefato (ausente, JSON inválido, válido), o fim detectado pelo marcador `resultado.json` e o desfecho de timeout quando o marcador não chega.
- `apps/api/src/jobs/teardown.test.ts` — trava idempotência, ordem das camadas (sinal de encerramento antes da remoção) e escopo por label.
- `apps/api/src/jobs/recuperacao.test.ts` — trava o comportamento do §10.12 e o contrato de `recuperarCorrecoesOrfas()` que a F4 consome, com o job dir preservado.
- `apps/api/src/janitor/janitor.test.ts` — trava as duas classes de retenção do §11, o formato de objeto de `pausa_global` e o fail-safe de banco indisponível.
- `tests/runner-entrypoint.test.ts` — integração com Docker: clone `file://`, checkout no SHA, fallback shallow, submodule tolerado, marcador escrito e runner vivo depois dele.

Mock só nas fronteiras (Docker CLI, git, relógio, aleatório do jitter); a lógica de override, retenção e recuperação roda de verdade.

## Riscos e armadilhas

- **Node fora do PATH em shell não-interativo** (STATUS.md): nvm só carrega em shell interativo. Script, hook ou cron que chame `node`/`pnpm` falha com "command not found". Usar caminho absoluto ou corepack no PATH do processo.
- **Gid do socket varia por máquina** (nesta, 989): imagem buildada com o gid errado dá `permission denied` no socket só quando o agente chama `docker` — falha tardia e confusa. Rebuildar após reinstalar Docker ou WSL; `scripts/build-runner.sh` sempre resolve o gid na hora.
- **Dono do job dir**: o runner escreve como uid 1000. Se `$JOBS_DIR` não for gravável por esse uid, o sintoma é "dossiê ausente" (§10.7) — que aponta para o lugar errado. Verificar na primeira execução.
- **`docker compose -p <proj> down` sem `-f`** depende de o compose localizar o projeto pelos labels dos containers; se a versão instalada exigir arquivo, o fallback é a remoção por `--filter label=com.docker.compose.project=`, que o teardown já executa como passo seguinte.
- **O guard `bloqueia-prune-docker.sh` bloqueia qualquer `docker <sub> prune`**, inclusive filtrado. É proposital: a saída é enumerar e `docker rmi` (D8), nunca contornar o guard.
- **O timeout do §10.9 cobre o job inteiro**, e o clone de até 120s está dentro dele. Repo grande mais toolchain pesada come o orçamento antes de a carga começar.
- **Tempestade de start**: sem o jitter de 5–15s, 4 runners instalando dependências ao mesmo tempo saturam a WSL. O `.wslconfig` do §17.4 entra como pré-condição desta fase justamente por isso — o teto de 4 do A2 pressupõe ele aplicado.
- **Runner que fica vivo de propósito vira órfão fácil** (D10): como o container não morre sozinho, todo caminho de saída do controller precisa passar pelo teardown, e o que escapar só sai pelo janitor (F2.7) ou pela recuperação de boot (F2.8). Sinal de alerta: `docker ps --filter label=fc.job` mostrando runner de pé sem correção `rodando` correspondente.
- **Risco §15 "Disco"**: o janitor é a mitigação e nasce aqui. Medir o consumo por job já no harness dá o número real para calibrar as retenções.
- **Socket do Docker no runner é poder total sobre o Docker da máquina** (§11): aceito conscientemente no MVP. Endurecer (socket proxy, egress restrito, rootless) é F8 — não "melhorar um pouquinho" agora.

## O que NÃO entra nesta fase

- Invocação do `claude -p`, `prompt-template.md`, montagem do `prompt.txt`, `dossie.schema.json`, validação do dossiê e retry corretivo via `--resume` → **F3** (o ponto de extensão fica pronto na F2.5)
- pg-boss, worker, `retry_n`, política de retry/timeout de fila, cancelamento, substituição, dedupe, pausa global obedecida e as transições de submissão do §6 → **F4** (a F2 entrega as primitivas `abortarJob`, `recuperarCorrecoesOrfas` e o timeout mecânico)
- A transição `corrigindo → na_fila` das correções recuperadas no boot, consumindo retry (§10.12) → **F4**, que chama `recuperarCorrecoesOrfas()` da F2.8 e percorre a lista devolvida — a marcação `falhou` continua sendo só da F2
- Gatilhos programáticos, incluindo `historico_nao_avaliado` e duração anômala → **F7**
- Bootstrap do Nest (`main.ts`, `AppModule`, DI) → **F4.0** · REST e SSE → **F5**
- Qualquer tela → **F6**
- Cap de CPU/memória nas stacks de aluno, socket proxy, egress lateral restrito, rootless → **F8** (§11)
- Backup diário e `docs/runbook.md` (inclusive a poda de cache de build da D8) → **F7**
- Golden repos G1–G10 → **F3/F7**; a F2 usa fixtures sintéticas próprias

## Impacto em fases seguintes

A preencher no encerramento da fase.

| O que mudou aqui | Fase afetada | O que foi atualizado lá |
|---|---|---|

## Registro de execução

A preencher durante a fase.

- **Iniciada em:** AAAA-MM-DD
- **Concluída em:** AAAA-MM-DD
- **Decisões tomadas:** (D1–D10, com link para STATUS.md / Apêndice B quando arquitetural; D6, D8 e D10 mudam §8/§9.2/§12 → Apêndice B)
- **Divergências do plano:** (o que divergiu, por quê, e onde foi registrado)
- **Evidência dos aceites:** (saída de comando, resultado de teste)
