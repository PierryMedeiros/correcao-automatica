# F0 — Fundação e spikes

> **Status:** ⏳ em andamento (iniciada 2026-08-07) — fundação pronta (F0.1–F0.3), spikes pendentes
> **Estimativa:** 1–2 dias úteis (plan §13)
> **Depende de:** nada — é a primeira fase
> **Destrava:** F1 (fundação do monorepo) · F2 (spikes S1, S2 e S3) · F3 (spike S1)
> **Seções do plano:** §13 F0 · §2.4–2.5 · §4 (stack, auth do agente) · §8 (runner, rede, invocação, teardown) · §9.2 · §10.13–15 · §15 · §17.3

## Objetivo

Deixar o repositório operável (monorepo, testes, lint, Postgres de dev, documentação e guards) e provar
em bancada os três riscos técnicos que o sistema inteiro assume como verdade: que o Claude Code roda
headless dentro de container autenticado por token, que o namespace de rede por container elimina
colisão de porta, e que um compose de aluno sobe sem portas publicadas dentro de uma network externa
pré-criada. Depois desta fase, F1–F3 começam sobre fatos verificados, não sobre suposição.

## Pré-condições

- [x] Node 24 ativo — `node -v` retorna `v24.*` (versão fixada em `.nvmrc`)
- [x] pnpm 11.7.0 via corepack — `pnpm -v` retorna `11.7.0` (pinado em `packageManager`)
- [x] Docker Engine responde sem sudo — `docker info` sai 0
- [ ] Sessão do Claude Code reiniciada depois dos hooks entrarem em `.claude/settings.json` — `/hooks` lista os três `PreToolUse` e `pnpm guards` sai 0 (os spikes mexem em Docker, que é o que o guard 1 protege)
- [ ] `.env` existe com o token preenchido — `grep -q '^CLAUDE_CODE_OAUTH_TOKEN=.\+' .env` sai 0, sem nunca imprimir o valor. **Destrava só o S1** (§17.3); se estiver vazio, pare e peça ao usuário rodar `claude setup-token` no host — não improvise substituto
- [ ] `docker compose version` ≥ 2.24 — habilita as tags `!reset`/`!override` do caminho principal do S3; abaixo disso vale o plano B da F0.6
- [ ] `$JOBS_DIR` do `.env` existe e é gravável — `mkdir -p "$JOBS_DIR" && test -w "$JOBS_DIR"` (S1 e S3 escrevem lá)

## Decisões do plano que esta fase materializa

| Decisão | Onde está | Consequência prática nesta fase |
|---|---|---|
| Vitest é entrega da F0, não dívida da F1 | Apêndice B v1.3 item 8 | O aceite exige `pnpm test` verde com **ao menos 1 teste real** — placeholder não conta |
| Regra dura só vale se for executável | Apêndice B v1.2 item 1 | Os três guards de `scripts/hooks/` e o `selftest.sh` entram no aceite da fase |
| Auth do agente por `CLAUDE_CODE_OAUTH_TOKEN`; montar `~/.claude` é fallback | §4, §15 | O S1 testa o caminho primário; o fallback só entra se o primário travar (D5) |
| Skills moram fora da árvore e são montadas de `$SKILLS_DIR` como `:ro` | §4, Apêndice B v1.3 item 6 | O S1 monta a skill de teste por bind `:ro`, não copia — mesma mecânica do §8 |
| Network externa criada **antes** do runner (elimina a corrida) | §8, Apêndice B (06/08) item 1 | A ordem do roteiro do S3 é obrigatória: network → runner → connect → stack |
| Netns por runner torna colisão de porta impossível, não proibida | §2.4, §8, §10.13 | É o que o S2 mede; falhar aqui derruba a premissa da arquitetura, não o teste |
| Nada destrutivo global | §2.5, regra dura 1 | Recursos dos spikes nascem com label `fc.job=<id>` e saem por label/prefixo |
| Transcript via `--output-format stream-json --verbose` | §4, §8 | O S1 tem que produzir `transcript.jsonl` parseável, não só stdout |
| A flag de permissão para execução não-assistida é decisão do S1 | §8 | Vira D1, e o resultado é restrição de entrada da F3 |

## Decisões a tomar nesta fase

| # | Pergunta em aberto | Opções | Recomendação |
|---|---|---|---|
| D1 | Qual flag libera execução não-assistida no CLI? | `--dangerously-skip-permissions` vs. `--allowedTools` explícito | Tentar `--allowedTools "Read,Write,Bash"` primeiro (menor superfície); se qualquer tool necessária ficar de fora, adotar `--dangerously-skip-permissions` — o container é a fronteira de segurança (§8). Registrar a escolha em `docs/spikes.md` |
| D2 | Onde moram os artefatos dos spikes? | `scripts/spikes/s{1,2,3}/` versionado vs. diretório temporário fora do repo | Versionado em `scripts/spikes/` — cabe no papel de `scripts/` no §4 e permite reexecutar quando CLI, Docker ou Compose atualizarem |
| D3 | A imagem do S1 vira semente do `runner/Dockerfile`? | Reaproveitar vs. descartável | Descartável (`banca-spike-s1:dev`, só Node + CLI + git). A F2 escreve o Dockerfile do §8 do zero e herda só o aprendizado (uid/gid do socket, flags) — regra dura 8 |
| D4 | Como identificar os recursos Docker dos spikes? | Ids sintéticos no esquema `fc-job-<id>` vs. nomes livres | Ids sintéticos `s1`, `s2a`, `s2b`, `s3` — mantém a regra dura 2 sem exceção e a limpeza usa o mesmo mecanismo do janitor da F2 |
| D5 | Se o S1 só passar pelo fallback (`~/.claude` montado), segue assim? | Seguir e ajustar depois vs. atualizar o plano antes da F2 | Atualizar §4/§8/§11 + Apêndice B **antes** da F2 — o fallback muda o que o runner monta e coloca credencial de sessão em disco montado |
| D6 | O S1 prova `claude --resume` via `docker exec`? | Não (o §13 não pede) vs. sim, como verificação mínima | Sim. O retry corretivo do §7 depende disso, e descobrir na F3 custa redesenho no meio da fase. Consequência que aparece junto: o entrypoint do runner **não pode encerrar** quando o `claude -p` retorna, senão não há runner vivo para o `docker exec` (§7 × §9.2) — a forma do entrypoint é decisão da F2, mas o fato nasce aqui |

## Etapas

### F0.1 — Monorepo, TypeScript, testes e lint ✅

**Entrega:** repositório executável — instalar, tipar, testar e lintar funcionam do zero.

**Arquivos:** `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.nvmrc`, `tests/skills-map.test.ts`

**Tarefas**

- [x] Fixar Node 24 em `.nvmrc` e pnpm 11.7.0 em `packageManager`
- [x] Declarar `apps/*` e `packages/*` no workspace **sem criar os pacotes** (cada um nasce na fase que o preenche)
- [x] Configurar TypeScript strict na base do monorepo
- [x] Configurar vitest e escrever ao menos 1 teste real (não placeholder)
- [x] Configurar eslint + prettier e os scripts `lint`, `format`, `typecheck`, `test`, `test:watch`

**Testes:** `tests/skills-map.test.ts` — trava o contrato do `docs/skills-map.csv`

**Pronto quando:** `pnpm lint`, `pnpm typecheck` e `pnpm test` saem 0 em clone limpo.

### F0.2 — Postgres de desenvolvimento ✅

**Entrega:** banco de dev de pé, com volume persistente, pronto para a F1 migrar.

**Arquivos:** `compose.yaml`, `.env.example`

**Tarefas**

- [x] Subir `postgres:16-alpine` com project name `banca-dev`, healthcheck e volume nomeado
- [x] Registrar `DATABASE_URL`, `SKILLS_DIR`, `JOBS_DIR`, `RUNNER_IMAGE` e `CLAUDE_CODE_OAUTH_TOKEN` no `.env.example`, sem nenhum valor real (regra dura 5)

**Testes:** nenhum — verificação é manual, ver Pronto quando

**Pronto quando:** `docker compose up -d` e `docker compose ps` mostram o serviço `db` `healthy`.

### F0.3 — Base de documentação e guards executáveis ✅

**Entrega:** as regras duras deixam de ser prosa e passam a bloquear; a documentação de entrada do projeto existe.

**Arquivos:** `CLAUDE.md`, `README.md`, `docs/project-plan.md`, `docs/STATUS.md`, `docs/INTEGRATION.md`, `docs/skills-map.csv`, `docs/legado/`, `scripts/hooks/*.sh`, `.claude/settings.json`

**Tarefas**

- [x] Escrever `CLAUDE.md` (regras duras, arquitetura de código, convenções) e as skills de desenvolvimento
- [x] Escrever `docs/INTEGRATION.md` com premissas e perguntas abertas para a equipe da plataforma FC
- [x] Implementar os guards de prune global de Docker, force push na main e segredo em conteúdo staged
- [x] Registrar os guards como `PreToolUse` em `.claude/settings.json` e pôr `git commit`/`git push` em `permissions.ask`
- [x] Escrever `scripts/hooks/selftest.sh` cobrindo os três guards

**Testes:** `scripts/hooks/selftest.sh` (20 verificações), exposto como `pnpm guards`

**Pronto quando:** `pnpm guards` sai 0 e `/hooks` lista os três hooks numa sessão nova.

### F0.4 — Spike S1: Claude Code headless dentro de container

**Entrega:** prova de que `claude -p` roda do início ao fim sem interação, autenticado só por
`CLAUDE_CODE_OAUTH_TOKEN`, lendo uma skill montada `:ro` e escrevendo um JSON — com transcript
capturado e a flag de permissão definida. É o risco nº 1 do projeto (§13, §15).

**Arquivos:** `scripts/spikes/s1/Dockerfile`, `scripts/spikes/s1/skill/SKILL.md`, `scripts/spikes/s1/prompt.txt`, `scripts/spikes/s1/run.sh`

**Tarefas**

- [ ] Verificar o token antes de qualquer build (pré-condição acima); token vazio = parar e escalar
- [ ] Escrever o Dockerfile mínimo: `ubuntu:24.04`, `git curl jq`, Node 22 (NodeSource), `npm i -g @anthropic-ai/claude-code`, usuário não-root `corrector` (uid 1000) — sem Go/PHP/Python, que são da F2
- [ ] `docker build -t banca-spike-s1:dev scripts/spikes/s1`
- [ ] Escrever `skill/SKILL.md` com instrução verificável e **impossível de acertar por acaso**: contar as linhas de um arquivo do workspace e copiar uma frase literal do próprio SKILL.md para o JSON de saída
- [ ] Preparar `$JOBS_DIR/s1/` com `repo/` (diretório qualquer com um arquivo de conteúdo conhecido) e `prompt.txt` mandando ler `/workspace/skill/SKILL.md` primeiro e seguir literalmente (§8)
- [ ] Subir o container com `--name fc-job-s1 --label fc.job=s1 --user corrector`, `-v $JOBS_DIR/s1:/workspace`, `-v $PWD/scripts/spikes/s1/skill:/workspace/skill:ro`, `-e CLAUDE_CODE_OAUTH_TOKEN` e um comando de longa duração como processo principal (para o `docker exec` do `--resume` ter onde acontecer)
- [ ] Invocar por `docker exec`: `claude -p "$(cat /workspace/prompt.txt)" --model <id do modelo> --output-format stream-json --verbose > /workspace/transcript.jsonl`
- [ ] Resolver D1: rodar primeiro com `--allowedTools`; se travar esperando permissão, repetir com `--dangerously-skip-permissions` e anotar a saída literal do travamento
- [ ] Anotar o **id exato do modelo** usado (§14: troca de modelo muda a régua) e o bloco de uso/custo da linha final do transcript (§15: embasa a conversa de API key)
- [ ] Conferir vazamento de segredo: `grep -c 'sk-ant' /workspace/transcript.jsonl` retorna 0
- [ ] (D6) Extrair o `session_id` do transcript e reinvocar no mesmo container: `docker exec fc-job-s1 claude --resume <session_id> -p "<correção>"`, verificando que o JSON de saída é reescrito
- [ ] Teardown por label: `docker rm -f $(docker ps -aq --filter label=fc.job=s1)`

**Testes:** nenhum automatizado — spike é experimento; a evidência vai para `docs/spikes.md`

**Pronto quando (todos, sem exceção):** o JSON de saída existe e é válido (`jq -e . out.json`); o campo
com a frase secreta bate **literalmente** com o SKILL.md montado; o `claude -p` saiu com código 0 sem
nenhuma interação humana; `transcript.jsonl` tem linhas `stream-json` parseáveis, com `session_id` e o
registro final de uso; o grep do token retorna 0; a flag de permissão adotada está registrada.

**Se falhar:** escada, nesta ordem. (1) Erro de credencial: confirmar que a variável chegou
(`docker exec fc-job-s1 sh -c 'test -n "$CLAUDE_CODE_OAUTH_TOKEN"'` — nunca imprimir o valor) e que o
token não expirou (regerar com `claude setup-token`). (2) Token rejeitado dentro do container mas
válido no host: aplicar o fallback do §4/§15 — montar `~/.claude` do host `:ro` — e então D5 vale, o
plano muda antes da F2. (3) Nem o fallback funciona: F0 não fecha e nada de F2/F3 começa (§13: "se
travar, tudo para até resolver"); registrar a saída literal do erro em `docs/spikes.md` e escalar ao
usuário no mesmo dia, sem gastar a fase inteira tentando às cegas.

### F0.5 — Spike S2: isolamento de rede por container

**Entrega:** prova de que dois runners servem na 8080 ao mesmo tempo sem colisão, e que cada um
enxerga o próprio processo em `localhost:8080` (§8, §10.13).

**Arquivos:** `scripts/spikes/s2/run.sh`

**Tarefas**

- [ ] Subir dois containers `fc-job-s2a` e `fc-job-s2b`, com labels `fc.job=s2a` / `fc.job=s2b`, **sem `-p`** e sem `--network host`, cada um servindo HTTP na 8080 com conteúdo que identifica o próprio container
- [ ] `docker exec fc-job-s2a curl -sf http://localhost:8080/` → marcador de A; `docker exec fc-job-s2b curl -sf http://localhost:8080/` → marcador de B
- [ ] Confirmar que nenhum publicou porta: `docker port fc-job-s2a` e `docker port fc-job-s2b` saem vazios
- [ ] Confirmar que o host não passou a servir nada na 8080 (`curl -sf http://localhost:8080/` falha)
- [ ] Teardown por prefixo: `docker rm -f $(docker ps -aq --filter 'name=^fc-job-s2')` e verificar `docker ps -a --filter 'name=^fc-job-s2'` vazio

**Testes:** nenhum automatizado — a repetição desta prova vira o cenário de 4 jobs fake em paralelo da F2 e a fixture G8 da F7

**Pronto quando:** as duas respostas são diferentes e cada uma corresponde ao próprio container; os
dois `docker port` vazios; a 8080 do host continua livre; nada sobra depois do teardown.

**Se falhar:** namespace compartilhado só acontece com `--network host` ou `--network container:<x>` —
conferir que o `docker run` não usa nenhum dos dois. Se ainda assim houver colisão, a premissa do §2.4
e do §10.13 caiu e a alternativa (alocação dinâmica de porta por job) é mudança de arquitetura:
Apêndice B antes da F2, não conserto local.

### F0.6 — Spike S3: compose sem portas + network externa

**Entrega:** prova da topologia exata do §8 — override gerado remove `ports:` e `container_name:`,
aponta a network default para uma externa pré-criada, e um segundo container já conectado a ela
alcança o serviço por hostname.

**Arquivos:** `scripts/spikes/s3/compose-aluno.yml`, `scripts/spikes/s3/gera-override.sh`, `scripts/spikes/s3/run.sh`

**Tarefas**

- [ ] Usar um `compose.yml` real de desafio, com `ports:` e `container_name:` fixos; na falta de um, escrever um equivalente mínimo (serviço `app` HTTP na 8080 + um `db`) e registrar em `docs/spikes.md` que o compose é sintético
- [ ] Escrever o gerador de override: para cada serviço, `ports: !reset []` e `container_name: !reset null`, mais `networks: { default: { name: fc-job-s3_net, external: true } }`. As tags `!reset`/`!override` são necessárias porque merge de lista em override **concatena** — `ports: []` puro não remove nada
- [ ] Criar a network **primeiro**, como manda o Apêndice B (06/08) item 1: `docker network create --label fc.job=s3 fc-job-s3_net`
- [ ] Subir o container que faz papel de runner (`--name fc-job-s3 --label fc.job=s3`, socket do host montado) e só então `docker network connect fc-job-s3_net fc-job-s3`
- [ ] De dentro dele, subir a stack: `docker compose -p fc-job-s3 -f compose-aluno.yml -f compose.override.yml up -d`
- [ ] De dentro dele, alcançar o serviço por hostname: `curl -sf http://app:8080/` responde — nunca por porta de host
- [ ] Verificar zero publicação: `docker compose -p fc-job-s3 ps` sem publishers e `docker port` vazio nos containers da stack
- [ ] Verificar que o `container_name:` fixo não pegou: `docker ps --filter name=<nome_fixo_do_compose>` vazio e os containers seguem o padrão `fc-job-s3-app-1`
- [ ] Verificar o caso §10.16/G9: se o compose de aluno tiver bind mount relativo, observar **onde ele resolve** — o daemon é o do host, então caminho relativo ao `/workspace` do runner não existe do lado de lá. Registrar o comportamento observado; se confirmar o problema, a correção (montar o job dir no mesmo caminho em host e runner) é mudança do §8 e vai para o Apêndice B antes da F2
- [ ] Teardown em camadas (§8): `docker compose -p fc-job-s3 down -v --remove-orphans` → `docker rm -f fc-job-s3` → `docker network rm fc-job-s3_net`
- [ ] Provar limpeza sem prune: `docker ps -aq --filter label=fc.job=s3` e `docker network ls --filter label=fc.job=s3` vazios

**Testes:** nenhum automatizado — o gerador de override de produção e seus testes são entrega da F2

**Pronto quando:** o curl por hostname responde de dentro do runner; nenhuma porta publicada no host;
nenhum container com o nome fixo do compose; o override foi **gerado**, não editado à mão; depois do
teardown, zero recurso com label `fc.job=s3`.

**Se falhar:** (a) Compose sem suporte a `!reset` → plano B: gerar um compose derivado
(`compose.noports.yml`) com os campos já removidos e subir com `-f`, que é o comportamento do
`fc-compose-noports.sh` legado que o §8 diz estar evoluindo; registrar a restrição como entrada da F2.
(b) Stack não nasce na network externa → conferir o bloco `networks.default` do override e testar o
formato alternativo (`networks: { fc-job-s3_net: { external: true } }` declarado por serviço),
registrando o que funcionou. (c) Runner não resolve o hostname → conferir a conexão real
(`docker inspect -f '{{json .NetworkSettings.Networks}}' fc-job-s3`) e usar o **nome do serviço**, não
o do container.

### F0.7 — `docs/spikes.md` consolidado e encerramento

**Entrega:** o resultado dos três spikes vira documento consultável, e a F2/F3 passam a ter restrições
de entrada escritas em vez de lembradas.

**Arquivos:** `docs/spikes.md`, `docs/STATUS.md`, `docs/project-plan.md` (marcação da fase)

**Tarefas**

- [ ] Uma seção por spike: objetivo em uma linha, comandos exatos executados, saída literal relevante (recortada e **sem token**), veredito e data
- [ ] Seção "Decisões que saíram dos spikes": D1 (flag de permissão), formato do override do S3, e as versões observadas de Docker, Compose e Claude Code CLI
- [ ] Seção "O que a F2 e a F3 herdam": o que está provado e o que continua em aberto
- [ ] Atualizar `docs/STATUS.md` (feito / próximo passo / decisões / observações) e marcar `### F0 — Fundação e spikes (1–2d) ✅ implementada em AAAA-MM-DD` no §13 do plano

**Testes:** nenhum

**Pronto quando:** `docs/spikes.md` existe com os três vereditos verdes e comandos reproduzíveis; o
§13 do plano está marcado ✅; o `STATUS.md` aponta a F1 como próximo passo.

## Edge cases do §10 cobertos aqui

| # | Caso | Como esta fase trata | Onde é verificado |
|---|---|---|---|
| 13 | N correções do mesmo desafio de porta fixa | Prova do netns por container | Aceite A6 (S2) |
| 14 | Compose do aluno publica portas fixas | Override remove `ports:`; acesso por hostname na network do job | Aceite A7 (S3) |
| 15 | `container_name:` fixo no compose | Override remove; containers seguem o padrão do project name | Aceite A7 (S3) |
| 10, 11 | Limite do plano / token expirado | Não são tratados aqui (detecção e pausa são F4), mas o S1 é a primeira oportunidade de capturar a **saída literal** do CLI nesses casos — se ocorrer durante o spike, registrar em `docs/spikes.md` como insumo da F4 | Oportunístico, F0.4 |

## Critérios de aceite

| # | Critério | Como provar | Evidência esperada |
|---|---|---|---|
| A1 | Lint verde | `pnpm lint` | Exit 0, eslint e prettier sem apontamento |
| A2 | Teste verde com ao menos 1 teste real | `pnpm test` | Exit 0, suite `tests/skills-map.test.ts` executada, 0 falhas |
| A3 | Guards das regras duras verdes | `pnpm guards` | 20 verificações verdes |
| A4 | Postgres de dev de pé | `docker compose up -d && docker compose ps` | Serviço `db` `healthy` |
| A5 | S1 verde | Roteiro F0.4 | JSON de saída válido com a frase literal do SKILL.md, exit 0 sem interação, transcript com `session_id` e uso, grep de token = 0 |
| A6 | S2 verde | Roteiro F0.5 | Dois curls internos com respostas distintas e corretas; `docker port` vazio nos dois |
| A7 | S3 verde | Roteiro F0.6 | `curl http://app:8080/` de dentro do runner responde; zero porta publicada; zero container com nome fixo; zero recurso `fc.job=s3` após teardown |
| A8 | Os três spikes documentados | Ler `docs/spikes.md` | Três seções com comando, saída, veredito e data; seção de decisões preenchida |

- [x] A1
- [x] A2
- [x] A3
- [x] A4
- [ ] A5
- [ ] A6
- [ ] A7
- [ ] A8

## Testes que nascem nesta fase

- `tests/skills-map.test.ts` (já existe) — trava o contrato do `docs/skills-map.csv`: cabeçalho, 6 colunas, `skill_slug` único e com prefixo, enum de `modo_avaliacao`, par `projeto`+`fase` único. É o contrato que o seed da F1 já nasce tendo que respeitar.
- `scripts/hooks/selftest.sh` (já existe) — 20 verificações dos três guards; é o que transforma o fail-open do hook em falha barulhenta.
- Os spikes não geram teste automatizado: spike é experimento com veredito documentado. O que eles provam vira teste de integração na F2 (jobs fake, teardown, órfãos) e E2E na F3/F7 (golden repos).

## Riscos e armadilhas

- **S1 é o risco nº 1 (§15).** Trate como timebox: se não ficar verde no primeiro dia, escale ao usuário com a saída literal do erro em vez de continuar tentando. Falha aqui não é detalhe de fase, é bloqueio de projeto.
- **`--dangerously-skip-permissions` e root não convivem.** O §8 já manda usuário não-root `corrector` (uid 1000); rodar o spike como root "só para testar" faz ele falhar por um motivo que não é o que se quer medir.
- **O token aparece em `docker inspect`.** `-e CLAUDE_CODE_OAUTH_TOKEN` herda o valor do ambiente, mas ele fica em `Config.Env`. Nunca cole saída de `docker inspect` em `docs/spikes.md`, log ou commit (regra dura 5).
- **gid do grupo `docker` no build.** Sem injetar o gid do socket do host, o usuário não-root leva permission denied ao falar com o daemon (§8). Isso não aparece no S1 (que não usa o socket) e aparece no S3.
- **Merge de lista em Compose concatena.** `ports: []` num override não remove porta nenhuma — ver F0.6.
- **Bind mount relativo do compose de aluno resolve no host**, não no runner, porque o daemon é o do host (§8). É a armadilha que o S3 deve olhar de propósito (§10.16, fixture G9).
- **Hooks só valem a partir da próxima sessão** (STATUS): verificado ao vivo que `docker system prune --help` passou com o `settings.json` já salvo. Reinicie antes de começar os spikes, que são justamente trabalho pesado de Docker.
- **Fail-open é o modo de falha do hook** (STATUS): guard sumido ou sem bit de execução deixa passar em silêncio. Rode `pnpm guards` ao mexer em qualquer um.
- **Node fora do PATH em shell não-interativo** (STATUS): script de spike que chame `node`/`pnpm` sem carregar o nvm falha com "command not found"; use caminho absoluto ou corepack.
- **A 5432 está publicada no host** pelo Postgres de dev. Ao verificar "zero portas publicadas" no S2/S3, não confunda o banco de dev com stack de aluno.
- **Limpeza dos spikes é por label/prefixo.** `docker system prune` está bloqueado por guard e é regra dura 1; os ids sintéticos de D4 existem exatamente para que a limpeza use o mesmo caminho do janitor.
- **WSL suspendendo no meio** (§10.28) corrompe a medição de duração e mata containers em voo; desative a suspensão antes dos spikes.

## O que NÃO entra nesta fase

- Imagem definitiva do runner, com Go/PHP/Python e toolchains do §8 → F2
- Job Controller, job dir, gerador de override de produção, janitor, teardown automatizado, jitter → F2
- `prompt-template.md` v2 e `dossie.schema.json` + validador → F3 (§7, Apêndice A)
- Schema Prisma, migrations, `pg_trgm`, seed do `skills_map` → F1
- `apps/api`, `apps/web`, `packages/shared` — declarados no workspace e não criados de propósito; cada um nasce na fase que o preenche (STATUS, 07/08/2026)
- Detecção de limite de plano / token inválido e pausa global → F4 (§10.10–11); aqui só se captura a saída literal do CLI, se ela aparecer
- `docs/runbook.md` → F7 (§12)
- Métrica de consumo por correção como funcionalidade → F8/§12; no S1 só se anota o número observado

## Impacto em fases seguintes

Parcial: as linhas abaixo vêm de F0.1–F0.3, já concluídas. As dos spikes são preenchidas no
encerramento da fase.

| O que mudou aqui | Fase afetada | O que foi atualizado lá |
|---|---|---|
| Vitest configurado e `tests/skills-map.test.ts` travando o contrato do CSV | F1 | O seed do `skills_map` nasce tendo que respeitar um contrato já testado |
| `apps/*` e `packages/*` declarados mas não criados | F1, F5, F6 | Cada fase cria o pacote que preenche; nenhuma herda shell vazio |
| Guards `PreToolUse` ativos (prune, force push, segredo) | Todas | Limpeza Docker por label/prefixo deixa de ser convenção e vira caminho único |
| Resultado dos spikes S1–S3 | F2, F3 | A preencher no encerramento da fase |

## Registro de execução

- **Iniciada em:** 2026-08-07
- **Concluída em:** —
- **Decisões tomadas:** Node 24 no host e Node 22 no runner (toolchain de aluno, §8) · pnpm 11.7.0 pinado · `apps/*`/`packages/*` declarados sem criar · hooks em `scripts/hooks/` (versionado, revisável em diff) e não em `.claude/hooks/` · prettier não formata markdown · `SKILLS_DIR` = `/home/pierry/fullcycle/.claude/skills` (49 skills) · o primeiro teste cobre o `skills-map.csv` em vez de ser placeholder. Todas registradas em `docs/STATUS.md` (07/08/2026)
- **Divergências do plano:** nenhuma introduzida pela implementação. As mudanças de escopo da própria F0 (vitest como entrega, guards executáveis, `INTEGRATION.md`) foram absorvidas no plano **antes** do código — Apêndice B v1.2 itens 1–2 e v1.3 item 8
- **Evidência dos aceites:** A1–A4 verdes em 07/08/2026 — `pnpm lint` exit 0; `pnpm test` com a suite do `skills-map.csv`; `pnpm guards` com 20 verificações verdes; `banca-dev-db-1` `healthy` com `restart: unless-stopped`. A5–A8 pendentes: dependem do `claude setup-token` (§17.3) e da execução dos spikes na ordem S1 → S2 → S3
