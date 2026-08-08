# F2 — Runner e execução de jobs

> **Status:** ✅ implementada em 2026-08-07
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

- [x] F1 marcada ✅ em `docs/fases/README.md`, com as tabelas `correcoes`, `submissoes`, `skills_map`,
      `config` e `eventos` migradas (`pnpm db:migrate` de banco zerado sai 0)
- [x] Harness de teste de banco da F1 entendido antes de escrever teste que toca Postgres: teste de
      banco mora em `apps/api/tests/**/*.test.ts` (projeto `db` do `vitest.config.ts`), roda contra
      `DATABASE_URL_TEST` (`banca_test`), recebe as tabelas limpas antes de cada teste e usa
      `prismaTeste()` de `apps/api/tests/setup-db.ts`. `fileParallelism: false` é o que impede um
      arquivo de truncar a fixture do outro — não reative
- [x] Spikes S2 (netns) e S3 (compose sem portas + network externa) verdes e documentados em
      `docs/spikes.md` — esta fase é a industrialização exata da topologia que eles provaram
- [x] Spike S1 verde: a imagem mínima com o CLI autenticou por `CLAUDE_CODE_OAUTH_TOKEN`
      (a flag de permissão decidida ali só é usada na F3, mas o Dockerfile da F2.1 já instala o CLI)
- [x] `.env` preenchido com `SKILLS_DIR`, `JOBS_DIR`, `RUNNER_IMAGE` e `CLAUDE_CODE_OAUTH_TOKEN`
      (pendência humana §17.3) — conferir com `test -d "$SKILLS_DIR"` e `test -d "$JOBS_DIR"`
- [x] `$SKILLS_DIR` tem ao menos uma skill `corrige-*` real e o `_shared/devolutivas-guide.md` que as skills citam — os dois são montados `:ro` (§8) e a ausência de qualquer um aborta o job
- [x] Docker Engine acessível sem sudo pelo usuário do host e gid do socket conhecido:
      `stat -c %g /var/run/docker.sock`
- [x] Disco com ≥ 15 GB livres (abaixo disso o janitor já nasce alertando, §10.19): `df -h /`
- [x] §17.4 aplicado — `nproc` dentro do WSL devolve ≥ 6 e a suspensão está desativada; o aceite de
      4 jobs fake em paralelo (A2) pressupõe isso

## Decisões do plano que esta fase materializa

| Decisão | Onde está | Consequência prática nesta fase |
|---|---|---|
| Network externa criada **antes** do runner (elimina a corrida) | §8, Apêndice B (06/08) item 1 | A ordem da F2.4 é obrigatória: network → runner → conecta → start |
| Quem clona e invoca é o entrypoint; o controller só prepara arquivos antes do `docker run` | §9.2 passos 3–4, Apêndice B (06/08) item 5 | F2.2 é do entrypoint, F2.3/F2.4 são do controller — não misturar responsabilidade |
| Teardown em 3 camadas, sempre executado (inclusive em timeout/kill) | §8 | F2.6 roda a camada 2 em `finally`; a camada 3 é o janitor (F2.7) |
| Retry corretivo do dossiê acontece com o runner **ainda vivo** | §7, §8 (ciclo de vida do runner), §9.2 passos 4 e 6, Apêndice B (06/08) item 6 e v1.5 item 2 | O entrypoint escreve `resultado.json` e **não** encerra o container (F2.2); F2.5 detecta o fim pelo marcador e deixa o ponto de extensão entre coleta e teardown, pronto para a F3 |
| Job dir órfão × referenciado são duas classes de retenção | §11, §12, Apêndice B v1.3 item 3 | O janitor consulta `correcoes` antes de apagar; dir de correção `falhou` fica 14 dias |
| Nada destrutivo global; limpeza sempre por label/prefixo | §2.5, §12, regra dura 1 | Todo `docker create`/`network create` leva `fc.job=<id>`; janitor filtra por label |
| Limites do runner e jitter de start | §8 | F2.4 aplica `--cpus 2 --memory 2.5g` e jitter de 5–15s; o teto de paralelismo é knob do run (F4) |
| Timeout efetivo = `skills_map.timeout_s ?? config.timeout_job_padrao_s` | §5, §10.9 | F2.5 lê o override da skill e o default de `config`, ambos gravados pela F1 — nenhum literal de timeout no código |
| Log do entrypoint vai para o job dir | §12 | F2.2 escreve `runner.log` dentro de `/workspace` |
| Skill e `_shared` montados `:ro` a partir de `$SKILLS_DIR`, sem cópia nem symlink | §4, §8, Apêndice B v1.3 item 6 e v1.5 item 1 | F2.4 monta `$SKILLS_DIR/<skill_slug>:/workspace/skill:ro` e `$SKILLS_DIR/_shared:/workspace/_shared:ro`, abortando se qualquer um dos caminhos não existir |
| Job dir montado **duas vezes**: em `/workspace` e no próprio caminho absoluto | §8, Apêndice B v1.6 item 1 (spike S3) | F2.4 passa os dois `-v`; F2.3 monta o comando canônico de compose com o caminho absoluto, não com `/workspace` — é o que impede o `./algo` do aluno de virar diretório vazio criado pelo daemon do host |
| Stack do aluno não carrega `fc.job=<id>`, e sim `com.docker.compose.project=fc-job-<id>` | §8, Apêndice B v1.6 item 2 (spike S3) | Teardown (F2.6) e janitor (F2.7) varrem os dois — varrer só o label do job deixa a stack inteira órfã |

## Decisões a tomar nesta fase

| # | Pergunta em aberto | Opções | Recomendação |
|---|---|---|---|
| D1 | Qual é o `<id>` de `fc-job-<id>` e de `$JOBS_DIR/<id>`? O plano usa `<id>` sem dizer de quem | `correcoes.id` · id do job do pg-boss (só existe na F4) · id próprio de job | `correcoes.id`, com a linha criada em `rodando` **antes** do `docker run`: o §10.12 só detecta órfã se a correção `rodando` já estiver persistida, e o §11 só distingue dir órfão de referenciado se o nome do dir for a chave. Ordem: insert `correcoes` → cria job dir → network → runner |
| D2 | Onde mora o Job Controller, o gerador de override e o janitor, se o bootstrap do Nest só chega na F4.0? | `apps/api/src/` como TS puro, sem `main.ts`/DI · pacote próprio · esperar a F4 | `apps/api/src/jobs/` e `apps/api/src/janitor/` em TS puro (funções e classes sem decorator); a F4.0 os embrulha em provider quando o `AppModule` nascer. A F1 já resolveu onde mora o Prisma: schema e migrations em `apps/api/prisma/`, e o client sai de `criarPrisma(url)` em `apps/api/src/db/client.ts` — **não** instanciar `PrismaClient` direto (o Prisma 7 exige driver adapter, e a fábrica é quem o monta) |
| D3 | O janitor é cron do pg-boss (§12), mas pg-boss só entra na F4 | função pura + entrada CLI (`pnpm janitor`) · antecipar pg-boss (viola regra dura 8) · cron temporário de terceiro | CLI: a F4 registra o cron chamando exatamente a mesma função. Registrar no STATUS.md como dívida com destino |
| D4 | Que carga o entrypoint executa sem o `claude -p`, que é entrega da F3? | seam `FC_PAYLOAD_CMD` (vazio na F2, preenchido pela F3 com a invocação headless) · imagem `banca-runner-fake` separada · escrever já a invocação (viola regra dura 8) | Seam. O controller escreve `job.json` no job dir com os dados do job (inclusive o comando canônico de compose); a F3 acrescenta a renderização de `prompt.txt` a partir de `runner/prompt-template.md` + `job.json` |
| D5 | O que a F2 faz com o `dossie.json`, se o schema é entrega da F3? | coletar como artefato (existe? é JSON parseável?) e deixar o ponto de extensão · antecipar o schema | Coletar + ponto de extensão entre coleta e teardown; a F3 pluga validador e retry corretivo (`docker exec` + `--resume`) ali, sem reordenar nada |
| D6 | `docker run -d` seguido de `network connect` deixa uma janela em que o runner roda fora da network do job | `docker create` → `network connect` → `docker start` · `run -d` + connect imediato · entrypoint espera sinal | create/connect/start: fecha a janela por construção, que é o espírito do Apêndice B (06/08) item 1. É mecanismo, não arquitetura — ao adotar, o §8 ganha uma linha e a troca vai para o Apêndice B |
| D7 | Como o fallback shallow (§10.17) chega ao backend, se `historico_nao_avaliado` é campo do dossiê (F3) e gatilho do backend (F7)? | marcador `clone.json` no job dir, escrito pelo entrypoint · variável de ambiente para o agente · o agente descobre sozinho | `clone.json`: o gatilho é do backend e não pode depender do que o agente escreveu no dossiê. A F3 faz o prompt refletir o marcador no campo do dossiê |
| D8 | §12 manda o janitor podar imagens dangling e cache de build, mas a regra dura 1 — e o guard `scripts/hooks/bloqueia-prune-docker.sh` — proíbem `docker image/builder prune` em qualquer forma, mesmo filtrada | remoção enumerada (`docker images -q -f dangling=true` + `docker rmi`) e cache de build fora do janitor, virando item do runbook (F7) · abrir exceção na regra dura 1 e no guard · não podar nada | Remoção enumerada + cache no runbook. É contradição real entre §12 e a regra dura 1: ao implementar, alinhar o texto do §12 e registrar no Apêndice B |
| D9 | O janitor da F2 já liga `config.pausa_global` no limiar de 5 GB (§10.19), se pausa global é entrega da F4? | sim, escreve o registro e a notificação; a F4 implementa quem obedece · só loga, e a F4 faz tudo | Escrever o registro: o §12 dá o monitoramento de disco ao janitor, e `pausa_global` é uma linha em `config` (tabela da F1). É **objeto, nunca booleano** — `{ ativa, motivo, desde, tentativas }`, com `motivo = "disco"` neste caminho. Quem obedece ao registro é a F4 |
| ~~D10~~ | Se o entrypoint pode encerrar quando a carga retorna | — | **Resolvida no plano (v1.5, §8 e §9.2)**: não pode. Escreve `resultado.json` e permanece vivo até o sinal do Job Controller, que detecta o fim pelo marcador. O número fica reservado — o arquivo o referencia |

## Etapas

### F2.0 — Harness de job fake

**Entrega:** o instrumento que executa N jobs fake fim a fim contra Docker de verdade — nasce primeiro porque é ele que prova o "Pronto quando" das etapas seguintes, e é a base do E2E da F7.

**Arquivos:** `scripts/job-fake/run.ts`, `scripts/job-fake/fixtures/compose-portas-fixas.yaml`, `scripts/job-fake/fixtures/repo-exemplo/`

**Tarefas**

- [x] `pnpm job-fake --n <N>`: semeia submissões e correções de teste (`modelo = "fake"`), dispara o pipeline F2.3 → F2.6 com `FC_PAYLOAD_CMD` apontando para `payload.sh`. O comando nasce aqui como esqueleto e ganha capacidade a cada etapa que o pipeline avança — o relatório final só fica completo quando a F2.6 existir
      · fechado em 2026-08-07 com o pipeline inteiro: `prepararJob` → `executarJob` (subir → acompanhar → teardown em `finally`)
- [x] Fixture de repo restaurada como bare repo local e clonada por `file://` — mesma escolha dos golden repos (§14, Apêndice B v1.1)
      · nasce em `scripts/job-fake/repo-fixture.ts` e é copiada para dentro do job dir: `/tmp` do host não é visível no runner, então `file://` só resolve a partir de `/workspace`
- [x] Fixture de compose com `ports: "8080:8080"` e `container_name:` fixo (§10.14, §10.15) mais um serviço que escuta direto na 8080 (§10.13)
      · o serviço direto na 8080 é o `python3 -m http.server` que o `payload.sh` sobe dentro do runner, fora de qualquer compose — que é exatamente o caso do §10.13
- [x] Flags `--dormir <s>` e `--timeout <s>` para provocar o aceite A3, e `--matar-no-meio` (SIGKILL no próprio processo com jobs em voo) para o A4
      · `--timeout` grava `skills_map.timeout_s` do desafio fake em vez de passar o número ao controller: é o caminho real do §10.9, e passar direto craveria um literal de segundos fora do banco. Sem a flag, o override é **limpo** — senão um `--timeout 10` de ontem mataria em 10s o job de hoje
- [x] Flag `--recuperar`: roda só a recuperação de órfãos e sai — é o segundo passo do A4, o "boot seguinte". Toda execução do harness começa pela recuperação, porque até a F5 este processo é o que o §10.12 chama de "processo que acompanha os jobs"
- [x] Relatório final por job: exit code, presença do dossiê estático e recursos remanescentes (deve ser zero)
      · sete colunas: correção, status, exit code, duração, dossiê, containers e networks remanescentes

**Testes:** nenhum próprio — este harness é quem executa os aceites A1–A5.

**Pronto quando:** as fixtures existem e `pnpm job-fake --help` lista as flags; o fim a fim (`--n 4` saindo 0, quatro dossiês estáticos e zero recurso remanescente) é a consolidação dos aceites, provada depois da F2.6.

### F2.1 — Imagem do runner

**Entrega:** imagem `banca-runner:<tag>` reprodutível, com o CLI do Claude, Docker CLI + compose e as toolchains do §8, rodando como usuário não-root.

**Arquivos:** `runner/Dockerfile`, `runner/.dockerignore`, `scripts/build-runner.sh`

**Tarefas**

- [x] Escrever `runner/Dockerfile` sobre `ubuntu:24.04` com versões pinadas: git, curl, jq, `docker-ce-cli` + `docker-compose-plugin`, Node 22 (NodeSource), Go (tarball), PHP 8.3 + Composer, Python 3.12 + pip (§8)
      · Go 1.26.5 com `sha256sum -c` do tarball; PHP 8.3 e Python 3.12 são os do apt do Ubuntu 24.04 (não há PPA a pinar)
- [x] Instalar `@anthropic-ai/claude-code` global com versão fixada no Dockerfile
      · `2.1.224`, a mesma que o S1 provou
- [x] Criar usuário `corrector` (uid 1000) no grupo `docker` criado com o gid recebido em `ARG DOCKER_GID`; **não** instalar sudo (§11)
- [x] `scripts/build-runner.sh`: resolve o gid com `stat -c %g /var/run/docker.sock`, builda com a tag de `RUNNER_IMAGE` e falha alto se a variável não estiver no `.env`
      · também exposto como `pnpm build:runner`
- [x] Declarar `ENTRYPOINT` apontando para o script da F2.2 e `WORKDIR /workspace`

**Testes:** nenhum de unidade — a verificação é o smoke da própria imagem (ver Pronto quando).

**Pronto quando:** `bash scripts/build-runner.sh` sai 0 e
`docker run --rm --entrypoint bash -v /var/run/docker.sock:/var/run/docker.sock $RUNNER_IMAGE -lc 'id -un && docker ps -q && claude --version && go version && node -v && php -v && python3 -V'`
responde tudo como `corrector`, sem `permission denied` no socket.

> `--entrypoint bash` foi acrescentado ao comando em 2026-08-07: com o `ENTRYPOINT` da própria
> etapa declarado, `docker run <imagem> bash -lc '…'` passa o `bash` como **argumento** do
> entrypoint, que os ignora e entra no fluxo do job. Sem a flag, o smoke não roda o que diz rodar.

### F2.2 — Entrypoint: clone, checkout e seam da carga

**Entrega:** o runner, ao subir, deixa o repo do aluno pronto em `/workspace/repo` no SHA pinado, executa a carga do job, sinaliza o fim por marcador e **permanece vivo** até o Job Controller mandar encerrar, com log completo no job dir.

**Arquivos:** `runner/entrypoint.sh`, `scripts/job-fake/payload.sh`

**Tarefas**

- [x] `set -euo pipefail`; ler `FC_JOB_ID` e os dados de `/workspace/job.json` (repo_url, commit_sha)
- [x] Redirecionar stdout/stderr para `/workspace/runner.log` preservando o código de saída (§12)
      · via `tee`, para não cegar o `docker logs` — que é o que se tem à mão quando o job dir ainda não está acessível
- [x] `git clone` completo com timeout de 120s; em estouro, refazer com `--depth 1` e escrever `/workspace/clone.json` com `{"shallow": true, "motivo": "timeout_120s"}` (§10.17, D7)
      · `clone.json` passou a ser escrito **sempre**, com `shallow: false` no caminho normal: o gatilho do §10.17 é do backend (F7) e ler um booleano é mais barato que distinguir "arquivo ausente" de "clone que não aconteceu"
- [x] `git checkout <commit_sha>`, com código de saída próprio quando o SHA não existe no clone
      · no caminho shallow, tenta antes `fetch --depth 1 origin <sha>`: a ponta rasa pode não conter o SHA pinado, e desistir do job aí seria perder a régua do §9.2
- [x] `git submodule update --init --recursive` tolerante a falha, registrando a falha em `clone.json` (§10.18)
- [x] Executar a carga em `FC_PAYLOAD_CMD` (D4); variável ausente = marcador com código próprio e mensagem explícita, sem encerrar o container
- [x] Ao fim da carga, escrever `/workspace/resultado.json` com `exit_code`, `finished_at` e o motivo do encerramento — é **este marcador**, e não a saída do container, que sinaliza o fim do job (D10)
      · escrita atômica (`.parcial` + `mv`), para o polling da F2.5 nunca ler JSON pela metade
- [x] **Não encerrar o container** depois do marcador: aguardar o sinal de encerramento do Job Controller (arquivo-sentinela `/workspace/encerrar` ou SIGTERM), para que o `docker exec` + `claude --resume` do §7 tenha runner vivo (F0 D6, D10). Falha do clone também escreve marcador e espera — quem derruba o runner é sempre o host
- [x] Escrever `scripts/job-fake/payload.sh`: sobe o compose de exemplo com o comando canônico de `job.json`, faz um `curl` por hostname de serviço, escreve `dossie.json` estático e roda `docker compose -p fc-job-<id> down -v`

**Códigos de saída do runner** (acima de 63 para não colidir com código de carga; vão virar
`correcoes.erro_resumo` legível na F2.5, sem ninguém parsear log): `64` job.json ausente/inválido ·
`65` clone falhou nas duas tentativas · `66` `commit_sha` inexistente no clone · `67`
`FC_PAYLOAD_CMD` ausente · `70` erro inesperado do próprio entrypoint.

**Testes:** `tests/runner-entrypoint.test.ts` (integração, exige Docker) — clone de bare repo local via `file://`, checkout do SHA, fallback shallow forçado por timeout artificial, submodule quebrado tolerado, `resultado.json` escrito com o exit code da carga e container ainda `running` depois dele.

**Pronto quando:** o runner rodando contra um bare repo local deixa `/workspace/repo` no SHA pedido, `runner.log` completo no job dir, `resultado.json` com o exit code da carga e `docker inspect -f '{{.State.Status}}' fc-job-<id>` ainda respondendo `running` até o teardown; com `FC_CLONE_TIMEOUT_S=0` o `clone.json` aparece com `shallow: true`.

> O seam do fallback mudou de `FC_CLONE_TIMEOUT_S=1` para `=0` em 2026-08-07. Com `=1` o teste não
> era determinístico: o bare repo local clona em milissegundos, então o clone completo termina antes
> do relógio e o caminho degradado nunca é exercitado. `0` significa "não tente o clone completo" —
> tratado explicitamente porque o `timeout` do GNU lê 0 como *sem limite* — e não é só recurso de
> teste: é o botão para o operador forçar o caminho raso num repo sabidamente gigante. O ramo do
> estouro de relógio de verdade (código 124) continua implementado e coberto pelo caso de clone que
> falha nas duas tentativas.

### F2.3 — Job dir e gerador de override noports

**Entrega:** dado um job, o sistema materializa `$JOBS_DIR/<correcao_id>/` com `job.json` e o override que neutraliza portas e nomes fixos e prende a stack do aluno na network do job.

**Arquivos:** `apps/api/src/jobs/job-dir.ts`, `apps/api/src/jobs/override-noports.ts`, `apps/api/src/jobs/override-noports.test.ts`

**Tarefas**

- [x] `criarJobDir(correcaoId)`: cria `$JOBS_DIR/<id>/` com dono/permissão que o uid 1000 do runner consiga escrever; falha se o dir já existir
- [x] Escrever `job.json`: aluno, projeto/fase, `skill_slug`, `repo_url`, `commit_sha`, timeout efetivo, `compose_project = fc-job-<id>` e o comando canônico de compose já montado com `-p` e os dois `-f`
      · o timeout efetivo exigiu antecipar `timeoutEfetivoS()` (`apps/api/src/jobs/timeout.ts`), que a F2.5 lista como tarefa dela — sem ele o `job.json` teria um literal de segundos, que o §10.9 proíbe. A contagem e o kill continuam sendo da F2.5
- [x] O comando canônico usa o **caminho absoluto do job dir**, não `/workspace` (plan §8, Apêndice B v1.6 item 1). O S3 provou que caminho relativo no compose do aluno resolve contra o diretório do arquivo e vai para o daemon do host: com `-f /workspace/...` o `./dados` do aluno vira `/workspace/dados`, que não existe no host, e o daemon monta um diretório vazio sem erro nenhum
- [x] `gerarOverrideNoports(compose)`: função pura que remove `ports:` e `container_name:` de **todos** os serviços e aponta a network default para `fc-job-<id>_net` com `external: true` (§8, §10.14, §10.15)
- [x] Tratar compose sem `networks:` declarada, com múltiplas networks e com serviços sem porta — o override nunca inventa serviço nem remove chave alheia
      · **divergência**: o override redireciona **todas** as networks do compose do aluno para a network do job, não só a `default`. Compose que separa `frontend`/`backend` criaria networks próprias do projeto, das quais o runner não participa — e o agente perderia o acesso por hostname que o §8 exige. O preço é achatar uma segmentação que o desafio talvez avaliasse; sem isso, a correção não enxerga a stack que ela mesma subiu
      · nome de serviço e de network são validados contra o formato do Compose antes de entrar no YAML gerado: o nome vem do repo do aluno e é dado externo interpolado em arquivo nosso
- [x] Registrar em `job.json` quais serviços tinham `container_name:` fixo (§10.15 pede o registro; o campo equivalente do dossiê é do agente, F3)

**Testes:** `override-noports.test.ts` (unidade, §14) — fixture do compose real usado no S3 mais os três formatos acima; override idempotente; resultado sem `ports`/`container_name` e com network externa.

**Pronto quando:** `pnpm test` cobre os casos acima e `docker compose -p fc-job-999 -f <base> -f <override> config` sai 0, sem nenhum `ports:`/`container_name:` e com `external: true` na network default.

### F2.4 — Network do job e subida do runner (ordem obrigatória)

**Entrega:** o runner sobe já dentro da network do job, com os limites, labels, mounts e variáveis do §8.

**Arquivos:** `apps/api/src/jobs/docker.ts`, `apps/api/src/jobs/job-controller.ts`, `apps/api/src/jobs/job-controller.test.ts`

**Tarefas**

- [x] Wrapper de Docker com `execFile` (nunca string de shell: URL de repo e nome de aluno são dado externo), timeout em toda chamada e log com `job_id`
- [x] `docker network create fc-job-<id>_net --label fc.job=<id>` **antes** de qualquer container (§8, Apêndice B (06/08) item 1)
- [x] `docker create --name fc-job-<id> --label fc.job=<id> --cpus 2 --memory 2.5g` com os mounts do §8 (job dir → `/workspace`; job dir → **o próprio caminho absoluto**; `$SKILLS_DIR/<skill_slug>` → `/workspace/skill:ro`; `$SKILLS_DIR/_shared` → `/workspace/_shared:ro`; `/var/run/docker.sock`) e env `CLAUDE_CODE_OAUTH_TOKEN`, `FC_JOB_ID`
      · o token entra como `-e CLAUDE_CODE_OAUTH_TOKEN`, **sem `=valor`**: o Docker copia do ambiente do processo, e assim o segredo não aparece em `ps` nem em log de comando (§8 escreve `-e CLAUDE_CODE_OAUTH_TOKEN=***`, que é a mesma intenção)
- [x] O mount-espelho do job dir no próprio caminho **não é redundância** (Apêndice B v1.6 item 1): é o que faz a resolução de caminho do compose significar a mesma coisa no runner e no daemon do host. Um teste do `job-controller.test.ts` trava os dois mounts — remover o espelho por "limpeza" reintroduz uma falha silenciosa
- [x] `docker network connect fc-job-<id>_net fc-job-<id>` e só então `docker start` (D6)
- [x] Abortar antes de criar qualquer recurso se `$SKILLS_DIR/<skill_slug>` ou `$SKILLS_DIR/_shared/devolutivas-guide.md` não existir — mount de caminho inexistente cria diretório vazio, e a correção rodaria sem critérios ou sem o guia de devolutivas, falhando em silêncio até a revisão humana (§8)
      · o teste prova o abort **e** que nenhuma linha de `correcoes` é criada nesse caminho
- [x] Jitter aleatório de 5–15s antes do start, com relógio e aleatório injetáveis para o teste (§8)
- [x] Nunca logar o valor de `CLAUDE_CODE_OAUTH_TOKEN` (regra dura 5)

O controller expõe `prepararJob` (correção + job dir, sem tocar em Docker) e `subirRunner`
(network → create → connect → start) além do `iniciarJob` que compõe os dois. A separação existe
porque o harness precisa escrever no job dir **entre** os dois passos — e é a mesma costura que a
F3 usa para pôr o `prompt.txt` lá antes de o runner subir (§9.2 passo 3).

**Testes:** `job-controller.test.ts` (unidade, wrapper Docker mockado) — a ordem das chamadas é network create → create → connect → start; skill ausente aborta antes de criar recurso; o token não aparece em nenhuma linha de log.

**Pronto quando:** com um job real, `docker inspect fc-job-<id> -f '{{json .NetworkSettings.Networks}}'` mostra bridge default **e** `fc-job-<id>_net`, e `docker inspect` confirma labels, `NanoCpus` e `Memory` — com o connect registrado antes do start.

### F2.5 — Acompanhamento, timeout e coleta de artefatos

**Entrega:** o controller detecta o fim do job pelo marcador do job dir (ou mata o runner no timeout), recolhe os artefatos e persiste a correção — com o runner ainda vivo quando o ponto de extensão da F3 roda.

**Arquivos:** `apps/api/src/jobs/job-controller.ts`, `apps/api/src/jobs/coleta.ts`, `apps/api/src/jobs/coleta.test.ts`

**Tarefas**

- [x] Detectar o fim pelo marcador `/workspace/resultado.json` no job dir (D10) — o runner segue vivo por construção, então **`docker wait` não é o sinal de fim**; observar o arquivo por watcher ou polling curto, tolerando escrita parcial (só vale JSON completo)
      · polling de 250 ms em `aguardarMarcador`, com relógio e sono injetáveis. Além do JSON completo, a **forma** é conferida: `resultado.json` sem `exit_code`/`finished_at`/`motivo` não é lido como fim
- [x] Calcular o timeout efetivo como `skills_map.timeout_s ?? config.timeout_job_padrao_s` (§5, §10.9) — nenhum literal de segundos no código; a contagem é do lado do host e vale mesmo se o marcador nunca aparecer
      · **o cálculo já existe** em `apps/api/src/jobs/timeout.ts` (`timeoutEfetivoS`), antecipado pela F2.3 porque o `job.json` declara o timeout do job. Falta aqui só a **contagem** do lado do host e o kill — usar a função, não reescrevê-la
      · a contagem começa no **start do runner**, não na criação da correção: o jitter de 5–15s do §8 é espera de fila, e descontá-lo do orçamento faria um `timeout_s` curto ser consumido antes de o container existir. `duracao_s` segue medida do `started_at` (Apêndice B v1.8 item 2)
- [x] Trocar a espera provisória do harness (`esperarMarcador` em `scripts/job-fake/run.ts`) pela coleta de verdade desta etapa. Ela nasceu na F2.0 só para o harness ter o que relatar antes da F2.5 existir, e duas implementações do mesmo polling é exatamente o tipo de divergência que ninguém percebe
      · a função provisória foi **apagada**; o harness chama `executarJob`
- [x] No estouro: `docker kill` do runner, `correcoes.status = timeout`, `erro_resumo` com a duração e o limite aplicado
- [x] Coletar `exit_code` (do marcador), `duracao_s`, `started_at`/`finished_at`, `runner.log`, `clone.json`, `resultado.json` e `dossie.json` (presente? JSON parseável?) — sem validar contra schema (D5)
- [x] Persistir `transcript_path` apontando para o caminho canônico do job dir (o arquivo só passa a existir com a invocação do agente, F3)
      · gravado na criação da correção (F2.4), não no fechamento: a coluna é NOT NULL e o job dir já é conhecido no insert
- [x] Deixar o ponto de extensão de validação **entre** coleta e teardown, com o runner ainda vivo, comentado com a referência ao §7 — é onde a F3 pluga validador e `--resume`
      · `aoColetar` (tipo `PontoDeValidacao`), opcional nas deps do controller. Recebe job, artefatos e status, e pode devolver artefatos **recoletados** — que é o que a F3 precisa depois de um `--resume` reescrever o `dossie.json`. Um teste trava que nenhuma remoção acontece antes dele
- [x] Atualizar `correcoes` (`concluida`/`falhou`/`timeout`, exit_code, duração, `erro_resumo`); `dossie` fica nulo até a F3 validar
- [x] Log estruturado (pino) com `job_id`/`submissao_id` em toda linha (§12)

**Testes:** `coleta.test.ts` (unidade) — job dir sem `dossie.json`, com JSON inválido e com JSON válido produzem os três resultados distintos; marcador ausente até o limite vira `timeout` e o job dir permanece; marcador escrito pela metade não é lido como fim.

**Pronto quando:** um job fake que dorme além do timeout é morto, a linha de `correcoes` fica `timeout`, e o job dir continua no disco com `runner.log` legível; um job fake normal fecha pelo marcador, com o runner ainda vivo no instante da coleta.

### F2.6 — Teardown em camadas

**Entrega:** nenhum recurso Docker do job sobrevive ao fim do job, qualquer que tenha sido o desfecho — e o job dir sobrevive sempre.

**Arquivos:** `apps/api/src/jobs/teardown.ts`, `apps/api/src/jobs/teardown.test.ts`

**Tarefas**

- [x] `teardown(correcaoId)` idempotente, chamado em `finally` de todo caminho (sucesso, falha, timeout, kill, exceção)
      · o `finally` está em `executarJob`, e envolve **também** o `subirRunner`: subida que falha no meio (network criada, container não) sai pelo mesmo caminho
- [x] Sinalizar o encerramento ao runner antes de removê-lo — ele permanece vivo por construção (D10): escrever o arquivo-sentinela do job dir (ou `docker stop` com grace curto) e só então seguir a ordem abaixo; o `docker rm -f` continua como garantia de que nada fica de pé
      · os três, em ordem: sentinela → `docker stop -t 10` → `rm -f`. Nenhum pode ser o único: o job dir pode ter sumido, o container pode estar travado e o daemon pode ter reiniciado
- [x] Ordem: `docker compose -p fc-job-<id> down -v --remove-orphans` → remover remanescentes por `--filter label=com.docker.compose.project=fc-job-<id>` → `docker rm -f fc-job-<id>` → desconectar e `docker network rm fc-job-<id>_net` → remover volumes por label (§8 camada 2)
      · o `down` ganhou **`--rmi local`** (plano v1.9, Apêndice B item 2): sem ele, as imagens que a stack do aluno builda (`fc-job-<id>-<serviço>`) sobrevivem ao teardown e se acumulam uma por correção. `local` e não `all` — `all` levaria junto as imagens só puxadas do registry, que são da máquina inteira
      · o `rm -f` do runner é precedido de uma listagem por nome: `docker rm -f` sai **0** para container inexistente, e sem a listagem o relatório afirmaria ter removido o que já estava morto — número que vai para `eventos` na recuperação de órfãos
- [x] Cada passo tolera "não existe" sem falhar o teardown, e registra no log o que de fato removeu
      · "não existe" é distinguido de falha de verdade pela mensagem do daemon (`no such`/`not found`) e **não** entra em `erros`: senão o segundo teardown do mesmo job — que é o caso normal — pareceria erro
- [x] **Nunca** apagar o job dir (§11) — limpeza de disco é do janitor
- [x] Expor `abortarJob(correcaoId)` = kill + teardown, primitiva que o cancelamento e a substituição da F4 vão consumir (§6)
      · exposta nas duas pontas: `teardown.abortar()` para quem tem o teardown à mão (a recuperação da F2.8) e `jobController.abortarJob()`, que é como a pré-condição da F4 a descreve

**Testes:** `teardown.test.ts` (wrapper mockado) — idempotência (duas execuções, zero erro), ordem das camadas, e nenhuma chamada de remoção sem filtro de label do job.

**Pronto quando:** após qualquer desfecho, `docker ps -a --filter label=fc.job=<id>`, `docker network ls --filter label=fc.job=<id>` e `docker volume ls --filter label=fc.job=<id>` saem vazios e `$JOBS_DIR/<id>` continua lá.

### F2.7 — Janitor

**Entrega:** rotina que limpa o que escapou do teardown, aplica as duas classes de retenção do §11 e vigia o disco.

**Arquivos:** `apps/api/src/janitor/janitor.ts`, `apps/api/src/janitor/janitor.test.ts`, `scripts/janitor.ts`

**Tarefas**

- [x] Remover containers/networks/volumes com label `fc.job=` ou prefixo `fc-job-` que não correspondam a uma correção em `rodando` (§12)
      · três formas de reconhecer o dono, porque são três criadores: label `fc.job` (nosso), `com.docker.compose.project=fc-job-<id>` (do compose que o agente rodou) e o prefixo do nome (o que sobra quando o recurso nasceu sem label). `identificarJob()` devolvendo `null` é o que protege o resto da máquina, e tem teste próprio
- [x] Job dir **órfão** — nome sem linha correspondente em `correcoes` — sai no ciclo, sem olhar idade (§11)
      · **exceção deliberada**: diretório cujo nome não é id de correção (`s1`, `s3`, dos spikes) é **preservado**, não tratado como órfão. "Não reconheço" não pode virar "então apago" num diretório que o operador também usa
- [x] Job dir **referenciado**, inclusive por correção `falhou` ou `timeout`, sai só aos 14 dias (§11)
      · idade medida por `finished_at ?? created_at`; correção `rodando` protege o dir independente de idade
- [x] Fail-safe: se a consulta a `correcoes` falhar, nenhum job dir é removido no ciclo e o erro é logado alto — apagar por engano é irreversível
      · **mais forte que a tarefa pedia**: o ciclo inteiro é abortado, inclusive a varredura Docker. Sem saber o que está `rodando`, remover container é matar job vivo — pior que deixar resto
- [x] ~~Imagens dangling por remoção enumerada (`docker images -q -f dangling=true` + `docker rmi`), nunca `prune`~~ → **imagens do job, por prefixo `fc-job-`** (regra dura 1, D8, plano v1.9)
      · a contradição §12 × regra dura 1 foi resolvida **no plano primeiro** (v1.8, Apêndice B item 1): o §12 passou a dizer "enumeração", e a poda de cache de build saiu do janitor para o runbook da F7
      · **corrigido em seguida (plano v1.9, Apêndice B item 1)**: enumerar dangling continuava sendo uma varredura **global** — a máquina é de trabalho e roda os containers de outros projetos do operador, cujo build intermediário sem tag entraria na lista. O janitor passa a varrer imagem **só por prefixo `fc-job-`**; dangling global acompanha o cache de build para o runbook, como comando humano
- [x] Disco: alerta abaixo do limiar de alerta e, abaixo do limiar de pausa, escrever `config.pausa_global` como **objeto** — `{ ativa: true, motivo: "disco", desde: <agora>, tentativas: 0 }` (§10.19, D9), nunca como booleano e nunca sobrescrevendo uma pausa já ativa de outro motivo; limiares `disco_alerta_gb` (15) e `disco_pausa_gb` (5) lidos de `config` (F1)
      · escreve também uma linha em `notificacoes` (§12 pareia pausa automática com notificação); espaço livre por `statfs`, injetável para o teste rebaixar o limiar sem encher disco
- [x] `pnpm janitor` roda um ciclo e imprime relatório do que removeu **e do que preservou**

**Testes:** `janitor.test.ts` — com job dirs falsos e linhas de `correcoes` semeadas: órfão sai; referenciado por `falhou` com 1 dia fica; referenciado com 15 dias sai; banco indisponível → zero remoção de job dir; limiar de disco rebaixado grava `pausa_global` com os quatro campos e `motivo: "disco"`.

**Pronto quando:** `pnpm janitor` sobre um estado montado à mão remove exatamente os órfãos, preserva os referenciados e imprime o relatório; suite acima verde.

### F2.8 — Recuperação de órfãos no boot

**Entrega:** reinício do processo host não deixa correção presa em `rodando` nem container de job vivo sem dono — e a rotina que faz isso é **a única** do sistema, exposta para a F4 chamar no boot.

**Arquivos:** `apps/api/src/jobs/recuperacao.ts`, `apps/api/src/jobs/recuperacao.test.ts`

**Tarefas**

- [x] No start do processo, listar `correcoes` em `rodando`. No MVP há um único processo dono dos jobs, então **toda** correção `rodando` encontrada no boot é órfã por definição — inclusive as de container ainda vivo, que ninguém iria coletar
- [x] Marcar como `falhou` com `erro_resumo = "órfã pós-reinício"` (§10.12) e rodar `abortarJob` para cada uma
      · a marcação vem **antes** do teardown: cair no meio da recuperação com a correção marcada deixa resto de Docker, que é problema do janitor; cair com ela ainda `rodando` deixa uma submissão que ninguém vai reenfileirar
- [x] Expor a rotina como `recuperarCorrecoesOrfas()`, que devolve a lista do que marcou — `correcao_id`, `submissao_id` e o resultado do teardown de cada uma. **Esta é a única implementação da marcação do §10.12**: quem precisar dela chama, não reescreve
      · devolve também `retry_n`, que é o número de que a F4 precisa para decidir entre `na_fila` e `erro` sem reconsultar
- [x] Preservar job dir e `runner.log`: a correção existe, logo o dir é referenciado (§11)
- [x] Registrar linha em `eventos` para a submissão de cada correção recuperada (auditoria, §12)
- [x] Documentar no módulo e no retorno da função que re-enfileirar a submissão (`corrigindo → na_fila`, consumindo retry, §6/§10.12) é responsabilidade de quem chama — a F4 percorre a lista devolvida e faz a transição de cada item

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
| 16 | Bind mount relativo do aluno resolve no host, não no runner | Job dir montado também no próprio caminho absoluto e comando canônico de compose usando esse caminho (F2.3, F2.4) — confirmado em bancada pelo spike S3 e absorvido no §8 (Apêndice B v1.6 item 1). A parte do §10.16 sobre `lint --fix` sujar o repo é regra de prompt, F3 | `job-controller.test.ts` (os dois mounts) + Aceite A2 |
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

- [x] A1
- [x] A2
- [x] A3
- [x] A4
- [x] A5
- [x] A6
- [x] A7

## Testes que nascem nesta fase

- `apps/api/src/jobs/override-noports.test.ts` — trava o contrato do override: `ports:` e `container_name:` somem de todos os serviços, a network default vira externa `fc-job-<id>_net`, nenhuma outra chave é tocada, e reaplicar o gerador dá o mesmo resultado.
- `apps/api/src/jobs/job-controller.test.ts` — trava a ordem network → create → connect → start (a corrida do Apêndice B (06/08) item 1), o abort quando a skill não existe, a ausência do token nos logs e os **dois** mounts do job dir (`/workspace` e o caminho absoluto espelhado, Apêndice B v1.6 item 1).
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

Descobertos ao implementar (2026-08-07):

- **`set +e` não desliga o trap de `ERR` em bash.** O entrypoint tratava a carga com `set +e`, e uma
  carga que saísse != 0 — desfecho previsto, o §7 espera o exit code do agente — caía no tratador de
  erro inesperado e virava marcador `70` em vez do código real. A forma correta é `cmd || codigo=$?`,
  que suprime errexit **e** trap. Custou um teste vermelho aqui; custaria um diagnóstico longo na F3.
- **`pnpm test` passou a exigir Docker de pé e a imagem do runner buildada**, além do Postgres que a
  F1 já exigia: `tests/runner-entrypoint.test.ts` roda contra a imagem de verdade. A falha é
  acionável (diz para rodar `pnpm build:runner`), mas quem clonar o repo agora tem dois
  pré-requisitos, não um. Mexer no `runner/entrypoint.sh` **exige rebuildar a imagem** antes de
  rodar os testes: o script é copiado para dentro dela, não montado.
- **O override não neutraliza `network_mode: host`.** Um compose de aluno com essa chave põe o
  container no namespace de rede do **host** — a porta volta a ser publicada de fato, dois jobs
  paralelos colidem e o isolamento do §2.4 cai, sem `ports:` nenhuma no arquivo. Não é caso do §10 e
  não foi tratado nesta fase (escopo): está nas observações do STATUS.md para você decidir se vira
  caso novo do §10 (neutralizar com `!reset`) ou gatilho de revisão.

Descobertos na segunda metade (2026-08-07):

- **`docker rm -f` sai 0 para container que não existe.** Um teardown que confia nesse código de
  saída conta como removido o que já estava morto — e esse número vai para `eventos` na recuperação
  de órfãos, onde vira a afirmação "havia container de pé" numa auditoria. O conserto é listar por
  nome antes de remover. Vale para a F4, que vai chamar `abortarJob` em cancelamento e substituição:
  o relatório é evidência, não estatística.
- **"Não existe" e "falhou" são desfechos diferentes e o daemon só os separa pela mensagem.** O
  teardown precisa distinguir os dois — senão o segundo teardown do mesmo job, que é o caminho
  normal, aparece como ciclo cheio de erro. A distinção é por regex em `no such`/`not found`, e a
  fragilidade é conhecida: se o texto do daemon mudar, o teste de idempotência quebra alto.
- **O timeout do §10.9 e `duracao_s` medem coisas diferentes**, e a diferença é o jitter de start
  (5–15s, §8). Contar o timeout desde a criação da correção faria um `timeout_s` de 10s ser
  consumido antes de o container existir — o `--timeout 10` do aceite A3 nunca chegaria à carga.
  Subiu para o plano (Apêndice B v1.8 item 2) porque a próxima pessoa que ler `erro_resumo` vai
  comparar os dois números.
- **Um `$JOBS_DIR` compartilhado com os spikes obriga o janitor a ter uma terceira resposta.** Os
  dirs `s1` e `s3` não têm linha em `correcoes` e, pela leitura literal do §11, seriam órfãos — e
  seriam apagados no primeiro ciclo. Nome que não é id de correção passa a ser **preservado** com
  motivo explícito no relatório: "não reconheço" não pode virar "então apago" num diretório que o
  operador também usa.
- **O janitor remove imagens dangling da máquina inteira, não só as nossas.** É o §12 pedindo, e
  imagem dangling é por definição sem tag e sem referência — mas num notebook de trabalho ela pode
  ser um build intermediário que alguém ainda quer. O daemon recusa remover imagem em uso, o que
  cobre o pior caso, e cada remoção sai nomeada no relatório. Fica registrado como escolha
  consciente, não como detalhe.

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

Revisão feita com os arquivos das fases seguintes abertos, procurando cada artefato pelo nome.

| O que mudou aqui | Fase afetada | O que foi atualizado lá |
|---|---|---|
| O override precisa do compose do aluno, que só existe depois do clone — e quem clona é o entrypoint. O gerador e o job dir estão prontos; a origem do compose no fluxo real, não | F3 | Tarefa nova na F3.3, antes da montagem do comando canônico, com as três saídas possíveis e o custo de cada uma. **Segue aberta e é a decisão mais consequente que a F2 deixa** |
| `timeoutEfetivoS()` (`apps/api/src/jobs/timeout.ts`) nasceu na F2.3 | F2.5 | Tarefa da F2.5 passou a dizer "usar, não reescrever" — cumprido |
| O harness ganhou uma espera provisória pelo marcador | F2.5 | Trocada pela coleta de verdade; a função provisória foi apagada |
| `prepararJob`/`subirRunner` separados no Job Controller | F3 | A F3.3 escreve o `prompt.txt` entre os dois passos, sem precisar de mecanismo novo |
| O ponto de extensão do §7 virou o tipo `PontoDeValidacao` (`aoColetar`), com teste travando que nenhuma remoção acontece antes dele | F3 | F3.5 reescrita: "Arquivos" aponta para o `aoColetar`, a tarefa de garantir a ordem do teardown foi marcada como **entregue pela F2**, e ficou explícito que a F2.5 já coletou e classificou o dossiê — a F3 valida conteúdo, não relê disco |
| A F2.5 persiste `status`, `exit_code`, `duracao_s`, `finished_at` e `erro_resumo` | F3 | Tarefa de persistência da F3.5 anotada com o que já está gravado; o que a F3 acrescenta é `veredito`, `dossie` e a linha de `devolutivas` |
| Superfície final do Job Controller: `prepararJob`, `subirRunner`, `iniciarJob`, `acompanharJob`, `executarJob`, `encerrarJob`, `abortarJob` | F4 | Pré-condição da F4 detalhada com a lista e com quem consome o quê (worker usa `prepararJob` + `executarJob`; cancelamento e substituição usam `abortarJob`) |
| `recuperarCorrecoesOrfas()` devolve também `retryN`, e o motivo/tipo de evento viraram constantes (`MOTIVO_ORFA`, `EVENTO_ORFA = correcao.orfa_recuperada`) | F4 | Pré-condição da F4 passou a citar a assinatura, o caminho do módulo e as constantes — repetir a string "órfã pós-reinício" à mão é como as duas pontas divergem |
| Janitor existe como `criarJanitor(...).executarCiclo()` e como `pnpm janitor` (D3) | F4 | Pré-condição nova: é essa função que o cron da F4.1 registra, e é a CLI que ele aposenta |
| O janitor grava a pausa por disco **com** a notificação, e não sobrescreve pausa ativa de outro motivo (D9) | F4 | Tarefa da F4.6 anotada para não duplicar notificação nem precedência no caminho `disco` |
| §12 alinhado com a regra dura 1: imagem dangling por enumeração, cache de build fora do janitor (D8, plano v1.8) | F7 | Tarefa nova na F7.11: o runbook documenta a poda de cache de build como **decisão humana**, com o porquê |
| Timeout contado do start do runner; `duracao_s` medida do `started_at` da correção | F7 | Tarefa do gatilho de duração anômala (F7.6) anotada com o viés do jitter e sua ordem de grandeza |

## Registro de execução

- **Iniciada em:** 2026-08-07
- **Concluída em:** 2026-08-07 (em duas sessões: F2.0–F2.4 na primeira, F2.5–F2.8 na segunda)

### Decisões tomadas

As nove decisões da fase foram resolvidas **conforme a recomendação do arquivo**, em duas levas: D1,
D2, D4, D6 e D7 na primeira sessão, confirmadas com o usuário antes de qualquer código; D3, D5, D8 e
D9 na segunda, seguindo o mesmo critério que o usuário já tinha fixado para as anteriores.

Só uma mexeu no plano: a **D8**, que era contradição real entre o §12 ("poda cache de build") e a
regra dura 1 ("nunca prune, nem filtrado"). Resolvida a favor da regra dura, **no plano primeiro**
(v1.8, Apêndice B item 1) e só depois no código. As outras oito são mecanismo, e o plano já
descrevia a intenção que elas materializam.

### Divergências do plano e do próprio arquivo da fase

| O que divergiu | Por quê | Onde está registrado |
|---|---|---|
| Smoke da F2.1 ganhou `--entrypoint bash` | com `ENTRYPOINT` declarado, `docker run <img> bash -lc` passa o bash como argumento e o smoke não roda o que diz rodar | "Pronto quando" da F2.1 |
| Seam do fallback shallow virou `FC_CLONE_TIMEOUT_S=0` (era `=1`) | bare repo local clona em milissegundos: com `=1` o caminho degradado nunca seria exercitado, e o teste passaria sem testar | "Pronto quando" da F2.2 |
| `clone.json` é escrito sempre, não só no caminho degradado | o gatilho do §10.17 é do backend (F7): ler `shallow: false` é mais barato que distinguir arquivo ausente de clone que não ocorreu | tarefa da F2.2 |
| Override redireciona **todas** as networks do aluno, não só a `default` | compose com `frontend`/`backend` criaria networks do projeto das quais o runner não participa, e o agente perderia o acesso por hostname que o §8 exige | tarefa da F2.3 |
| Token entra como `-e CLAUDE_CODE_OAUTH_TOKEN`, sem `=valor` | o Docker copia do ambiente do processo; o valor deixa de existir em `ps` e em log de comando. Mesma intenção do `-e …=***` do §8, com superfície menor | tarefa da F2.4 |
| `timeoutEfetivoS()` nasceu na F2.3, não na F2.5 | o `job.json` declara o timeout do job, e a alternativa era um literal de segundos que o §10.9 proíbe | tarefas da F2.3 e da F2.5 |
| O timeout do §10.9 é contado do **start do runner**, não da criação da correção | o jitter de 5–15s do §8 é espera de fila; contá-lo faria o `--timeout 10` do aceite A3 se esgotar antes de o container existir. `duracao_s` continua medida do `started_at` | plano v1.8 (Apêndice B item 2) e tarefa da F2.5 |
| O fail-safe do janitor aborta o **ciclo inteiro**, não só a remoção de job dirs | a tarefa pedia proteger os job dirs; sem saber o que está `rodando` também não dá para remover container, e remover container de job vivo é pior que deixar resto | tarefa da F2.7 |
| Job dir com nome que não é id de correção é **preservado**, não tratado como órfão | `$JOBS_DIR` é compartilhado com os spikes (`s1`, `s3`), que pela leitura literal do §11 seriam apagados no primeiro ciclo | tarefa da F2.7 |
| O janitor grava **também** uma linha em `notificacoes` ao pausar por disco | a D9 dava a opção; o §12 pareia pausa automática com notificação, e pausa sem aviso é sistema parado sem ninguém saber por quê | tarefa da F2.7 |
| `--timeout` do harness grava `skills_map.timeout_s` em vez de passar o número ao controller | é o caminho real do §10.9; passar direto craveria um literal de segundos fora do banco, que é o que a fórmula única existe para impedir | tarefa da F2.0 |
| O janitor varre imagem **só por prefixo `fc-job-`**, e não imagem dangling da máquina | a máquina é de trabalho: dangling global alcança build intermediário de outro projeto do operador. Correção feita depois do encerramento da fase, a pedido do usuário | plano v1.9 (Apêndice B item 1) e tarefa da F2.7 |
| O teardown roda `compose down` com **`--rmi local`** | `down` sozinho não remove as imagens que a stack do aluno buildou, e são elas que enchem o disco — não a dangling da máquina. Não foi pego no aceite porque a fixture usa `image: busybox`, sem `build:` | plano v1.9 (Apêndice B item 2) e tarefa da F2.6 |

### Correção posterior ao encerramento (2026-08-07)

A fase fechou e, ao ler o resumo, o usuário perguntou: *"mesmo quando eu não estiver corrigindo
nada ele vai ficar rodando? isso derrubaria os containers das minhas outras aplicações"*. A pergunta
achou um **requisito que o plano nunca tinha escrito** — a máquina é de trabalho e roda outros
projetos do operador — e uma lacuna: o §12 dava o janitor ao cron do pg-boss e nunca dizia de quanto
em quanto tempo.

Container, network e volume já estavam escopados e com teste de controle (`banca-dev-db-1`,
`postgres-do-usuario`, `nginx` intocados). O furo real era imagem, e ele foi fechado aqui; o ciclo de
vida do janitor virou decisão de plano e é a F4 quem o implementa. Tudo em `docs/project-plan.md`
v1.9, Apêndice B — as três mudanças estão nos itens 1, 2 e 3.

### Evidência

- **F2.1** — `bash scripts/build-runner.sh` sai 0; smoke responde `uid=1000(corrector) … groups=…,989(dockerhost)`, `docker ps` funciona sem `permission denied`, `claude 2.1.224`, `go1.26.5`, `node v22.23.2`, `PHP 8.3.6`, `Python 3.12.3`, `Composer 2.10.2`, `compose 5.4.0`.
- **F2.2** — `tests/runner-entrypoint.test.ts`, 6 testes verdes: checkout no SHA pinado com o container ainda `running` depois da carga e saindo pela sentinela; `clone.json` com `shallow: true` sob `FC_CLONE_TIMEOUT_S=0`; submodule quebrado tolerado com `submodules.ok = false`; clone impossível → marcador 65 com runner vivo; SHA inexistente → 66; sem `FC_PAYLOAD_CMD` → 67.
- **F2.3** — `override-noports.test.ts`, 15 testes verdes. Com Docker real: `docker compose -p fc-job-999 -f <base do S3> -f <override gerado> config` sai 0, o resolvido não tem **nenhum** `ports:`/`container_name:` e a `default` sai como `name: fc-job-999_net, external: true`.
- **F2.4** — `job-controller.test.ts`, ordem `network create → create → connect → jitter → start`, os dois mounts do job dir, `:ro` de skill e `_shared`, abort sem criar recurso, token fora de log e de argv, correção `rodando` antes do Docker. Com job real: `docker inspect fc-job-1` mostra `["bridge","fc-job-1_net"]`, `fc.job=1`, `NanoCpus 2000000000`, `Memory 2684354560`, os cinco mounts com `rw=false` na skill e no `_shared`, e `PORTS=[]`.
- **F2.5** — `coleta.test.ts` (14) e os 6 testes novos do `job-controller.test.ts`: marcador pela metade e marcador sem os campos do contrato **não** são lidos como fim; marcador na borda do limite ainda vale; os três estados do dossiê; código do runner virando `erro_resumo` legível; sem marcador → `kill` + `timeout` com job dir preservado; `aoColetar` rodando depois da coleta e antes de qualquer remoção.
- **F2.6** — `teardown.test.ts`, 10 testes: sentinela escrita antes de qualquer remoção, ordem stack → runner → network → volumes, desconexão de endpoint teimoso, idempotência com zero erro, falha de verdade no relatório sem interromper os passos seguintes, job dir intacto, `abortar` com `kill` na primeira posição, e a varredura que prova que nenhuma remoção sai do escopo do job nem usa `prune`.
- **F2.7** — `janitor.test.ts`, 13 testes, incluindo os dois lados de `identificarJob` (reconhece nossos três formatos; devolve `null` para `banca-dev-db-1` e afins). Com Docker real: recursos órfãos plantados à mão (`fc-job-9999` por label, `fc-job-9999-app-1` por label do compose, network e volume) são removidos os quatro, e o `banca-dev-db-1` segue de pé.
- **F2.8** — `recuperacao.test.ts`, 7 testes. Ao vivo: as **cinco correções `rodando`** que a primeira metade deixou no banco de dev foram reconhecidas como órfãs no primeiro boot da segunda sessão, marcadas `falhou` com `erro_resumo = "órfã pós-reinício"`, com job dir intacto.
- **A1** — `pnpm job-fake --n 1`: correção 6 `concluida`, `exit_code 0`, dossiê escrito, 17s, **0 containers e 0 networks** remanescentes.
- **A2 + A6** — `pnpm job-fake --n 4`: correções 7–10 `concluida` com `exit_code 0`, cada uma respondendo o próprio marcador em `localhost:8080` (§10.13) e em `http://app:8080` (§10.14); `docker ps --format '{{.Ports}}'` mostra só o Postgres de dev; `docker ps -aq --filter label=fc.job` e `docker network ls -q --filter label=fc.job` voltam **vazios** ao fim.
- **A3** — `pnpm job-fake --n 1 --dormir 60 --timeout 10`: correção 11 em `timeout`, `exit_code` nulo, `erro_resumo` com o limite de 10s e a duração total, execução inteira em 23,8s (jitter + 10s de limite), zero recurso remanescente, job dir preservado.
- **A4** — `pnpm job-fake --n 2 --matar-no-meio` deixa `fc-job-12` e `fc-job-13` de pé com suas networks; `pnpm job-fake --recuperar` marca as duas `falhou` ("órfã pós-reinício"), remove 1 container e 1 network de cada, e `docker ps -a --filter name=^fc-job-` e a listagem de networks voltam **vazias**; os 13 job dirs seguem no disco.
- **A5** — `pnpm janitor` sobre estado montado à mão: remove `999` ("órfão: nenhuma correção o referencia") e o job dir da correção 1, backdatada para 20 dias ("acima dos 14 dias de retenção"); **preserva** os referenciados por `falhou`/`timeout`/`concluida` dentro do prazo e os dirs `s1`/`s3` dos spikes, cada um com o motivo impresso no relatório.
- **A7** — `pnpm lint`, `pnpm typecheck`, `pnpm test` (**336 testes**, 17 arquivos) e `pnpm guards` (31 verificações) verdes.
