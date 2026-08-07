# F0 — Fundação e spikes

> **Status:** ✅ implementada em 2026-08-07
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
- [x] Sessão do Claude Code reiniciada depois dos hooks entrarem em `.claude/settings.json` — `/hooks` lista os três `PreToolUse` e `pnpm guards` sai 0 (os spikes mexem em Docker, que é o que o guard 1 protege). Verificado ao vivo: `docker system prune --help` foi bloqueado pelo guard 1
- [x] `.env` existe com o token preenchido — `grep -q '^CLAUDE_CODE_OAUTH_TOKEN=.\+' .env` sai 0, sem nunca imprimir o valor. **Destrava só o S1** (§17.3); se estiver vazio, pare e peça ao usuário rodar `claude setup-token` no host — não improvise substituto. **Verificar também o formato**: o token do `setup-token` começa com `sk-ant-oat01-`; o código que o navegador exibe no meio do fluxo é outro valor e dá `401 Invalid bearer token`
- [x] `docker compose version` ≥ 2.24 — habilita as tags `!reset`/`!override` do caminho principal do S3; abaixo disso vale o plano B da F0.6. Observado: v5.0.0
- [x] `$JOBS_DIR` do `.env` existe e é gravável — `mkdir -p "$JOBS_DIR" && test -w "$JOBS_DIR"` (S1 e S3 escrevem lá)

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
| D1 | Qual flag libera execução não-assistida no CLI? | `--dangerously-skip-permissions` vs. `--allowedTools` explícito | Tentar `--allowedTools "Read,Write,Bash"` primeiro (menor superfície); se qualquer tool necessária ficar de fora, adotar `--dangerously-skip-permissions` — o container é a fronteira de segurança (§8). Registrar a escolha em `docs/spikes.md`. **Resolvida: `--allowedTools Read,Write,Bash`**, verde de primeira, `permission_denials: []`. Ressalva que vira entrada da F3: tool fora da lista não trava a execução — ela é negada e o agente segue, então a lista precisa cobrir o que as skills exigem e o array `permission_denials` do transcript tem que ser lido |
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

**Testes:** `scripts/hooks/selftest.sh` (31 verificações), exposto como `pnpm guards`

**Pronto quando:** `pnpm guards` sai 0 e `/hooks` lista os três hooks numa sessão nova.

### F0.4 — Spike S1: Claude Code headless dentro de container

**Entrega:** prova de que `claude -p` roda do início ao fim sem interação, autenticado só por
`CLAUDE_CODE_OAUTH_TOKEN`, lendo uma skill montada `:ro` e escrevendo um JSON — com transcript
capturado e a flag de permissão definida. É o risco nº 1 do projeto (§13, §15).

**Arquivos:** `scripts/spikes/s1/Dockerfile`, `scripts/spikes/s1/skill/SKILL.md`, `scripts/spikes/s1/prompt.txt`, `scripts/spikes/s1/run.sh`

**Tarefas**

- [x] Verificar o token antes de qualquer build (pré-condição acima); token vazio = parar e escalar
- [x] Escrever o Dockerfile mínimo: `ubuntu:24.04`, `git curl jq`, Node 22 (NodeSource), `npm i -g @anthropic-ai/claude-code`, usuário não-root `corrector` (uid 1000) — sem Go/PHP/Python, que são da F2
- [x] `docker build -t banca-spike-s1:dev scripts/spikes/s1`
- [x] Escrever `skill/SKILL.md` com instrução verificável e **impossível de acertar por acaso**: contar as linhas de um arquivo do workspace e copiar uma frase literal do próprio SKILL.md para o JSON de saída
- [x] Preparar `$JOBS_DIR/s1/` com `repo/` (diretório qualquer com um arquivo de conteúdo conhecido) e `prompt.txt` mandando ler `/workspace/skill/SKILL.md` primeiro e seguir literalmente (§8)
- [x] Subir o container com `--name fc-job-s1 --label fc.job=s1 --user corrector`, `-v $JOBS_DIR/s1:/workspace`, `-v $PWD/scripts/spikes/s1/skill:/workspace/skill:ro`, `-e CLAUDE_CODE_OAUTH_TOKEN` e um comando de longa duração como processo principal (para o `docker exec` do `--resume` ter onde acontecer)
- [x] Invocar por `docker exec`: `claude -p "$(cat /workspace/prompt.txt)" --model <id do modelo> --output-format stream-json --verbose > /workspace/transcript.jsonl`
- [x] Resolver D1: rodar primeiro com `--allowedTools`; se travar esperando permissão, repetir com `--dangerously-skip-permissions` e anotar a saída literal do travamento. **Passou de primeira com `--allowedTools Read,Write,Bash`**, `permission_denials: []` — `--dangerously-skip-permissions` não foi necessário
- [x] Anotar o **id exato do modelo** usado (§14: troca de modelo muda a régua) e o bloco de uso/custo da linha final do transcript (§15: embasa a conversa de API key). `claude-opus-5`, CLI 2.1.224, `total_cost_usd` 0,1368 para uma carga trivial
- [x] Conferir vazamento de segredo: `grep -c 'sk-ant' /workspace/transcript.jsonl` retorna 0
- [x] (D6) Extrair o `session_id` do transcript e reinvocar no mesmo container: `docker exec fc-job-s1 claude --resume <session_id> -p "<correção>"`, verificando que o JSON de saída é reescrito
- [x] Teardown por label: `docker rm -f $(docker ps -aq --filter label=fc.job=s1)`

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

- [x] Subir dois containers `fc-job-s2a` e `fc-job-s2b`, com labels `fc.job=s2a` / `fc.job=s2b`, **sem `-p`** e sem `--network host`, cada um servindo HTTP na 8080 com conteúdo que identifica o próprio container
- [x] `docker exec fc-job-s2a wget -qO- http://localhost:8080/` → marcador de A; `docker exec fc-job-s2b wget -qO- http://localhost:8080/` → marcador de B (busybox traz `wget`, não `curl`; para o que o S2 mede os dois clientes são equivalentes)
- [x] Confirmar que nenhum publicou porta: `docker port fc-job-s2a` e `docker port fc-job-s2b` saem vazios
- [x] Confirmar que o host não passou a servir nada na 8080 (`curl -sf http://localhost:8080/` falha)
- [x] Teardown por prefixo: `docker rm -f $(docker ps -aq --filter 'name=^fc-job-s2')` e verificar `docker ps -a --filter 'name=^fc-job-s2'` vazio

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

- [x] Usar um `compose.yml` real de desafio, com `ports:` e `container_name:` fixos; na falta de um, escrever um equivalente mínimo (serviço `app` HTTP na 8080 + um `db`) e registrar em `docs/spikes.md` que o compose é sintético
- [x] Escrever o gerador de override: para cada serviço, `ports: !reset []` e `container_name: !reset null`, mais `networks: { default: { name: fc-job-s3_net, external: true } }`. As tags `!reset`/`!override` são necessárias porque merge de lista em override **concatena** — `ports: []` puro não remove nada
- [x] Criar a network **primeiro**, como manda o Apêndice B (06/08) item 1: `docker network create --label fc.job=s3 fc-job-s3_net`
- [x] Subir o container que faz papel de runner (`--name fc-job-s3 --label fc.job=s3`, socket do host montado) e só então `docker network connect fc-job-s3_net fc-job-s3`
- [x] De dentro dele, subir a stack: `docker compose -p fc-job-s3 -f compose-aluno.yml -f compose.override.yml up -d`
- [x] De dentro dele, alcançar o serviço por hostname: `curl -sf http://app:8080/` responde — nunca por porta de host
- [x] Verificar zero publicação: `docker compose -p fc-job-s3 ps` sem publishers e `docker port` vazio nos containers da stack
- [x] Verificar que o `container_name:` fixo não pegou: `docker ps --filter name=<nome_fixo_do_compose>` vazio e os containers seguem o padrão `fc-job-s3-app-1`
- [x] Verificar o caso §10.16/G9: se o compose de aluno tiver bind mount relativo, observar **onde ele resolve** — o daemon é o do host, então caminho relativo ao `/workspace` do runner não existe do lado de lá. **Confirmado**: o compose resolveu `./dados` para `/workspace/dados`, que não existe no host. Correção (job dir no mesmo caminho em host e runner) subiu ao plano §8 e ao Apêndice B v1.6 antes da F2
- [x] Teardown em camadas (§8): `docker compose -p fc-job-s3 down -v --remove-orphans` → `docker rm -f fc-job-s3` → `docker network rm fc-job-s3_net`
- [x] Provar limpeza sem prune: `docker ps -aq --filter label=fc.job=s3` e `docker network ls --filter label=fc.job=s3` vazios

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

- [x] Uma seção por spike: objetivo em uma linha, comandos exatos executados, saída literal relevante (recortada e **sem token**), veredito e data
- [x] Seção "Decisões que saíram dos spikes": D1 (flag de permissão), formato do override do S3, e as versões observadas de Docker, Compose e Claude Code CLI
- [x] Seção "O que a F2 e a F3 herdam": o que está provado e o que continua em aberto
- [x] Atualizar `docs/STATUS.md` (feito / próximo passo / decisões / observações) e marcar `### F0 — Fundação e spikes (1–2d) ✅ implementada em AAAA-MM-DD` no §13 do plano

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
| A3 | Guards das regras duras verdes | `pnpm guards` | 31 verificações verdes |
| A4 | Postgres de dev de pé | `docker compose up -d && docker compose ps` | Serviço `db` `healthy` |
| A5 | S1 verde | Roteiro F0.4 | JSON de saída válido com a frase literal do SKILL.md, exit 0 sem interação, transcript com `session_id` e uso, grep de token = 0 |
| A6 | S2 verde | Roteiro F0.5 | Dois curls internos com respostas distintas e corretas; `docker port` vazio nos dois |
| A7 | S3 verde | Roteiro F0.6 | `curl http://app:8080/` de dentro do runner responde; zero porta publicada; zero container com nome fixo; zero recurso `fc.job=s3` após teardown |
| A8 | Os três spikes documentados | Ler `docs/spikes.md` | Três seções com comando, saída, veredito e data; seção de decisões preenchida |

- [x] A1
- [x] A2
- [x] A3
- [x] A4
- [x] A5
- [x] A6
- [x] A7
- [x] A8

## Testes que nascem nesta fase

- `tests/skills-map.test.ts` (já existe) — trava o contrato do `docs/skills-map.csv`: cabeçalho, 6 colunas, `skill_slug` único e com prefixo, enum de `modo_avaliacao`, par `projeto`+`fase` único. É o contrato que o seed da F1 já nasce tendo que respeitar.
- `scripts/hooks/selftest.sh` (já existe) — 31 verificações dos três guards; é o que transforma o fail-open do hook em falha barulhenta.
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

| O que mudou aqui | Fase afetada | O que foi atualizado lá |
|---|---|---|
| Vitest configurado e `tests/skills-map.test.ts` travando o contrato do CSV | F1 | O seed do `skills_map` nasce tendo que respeitar um contrato já testado |
| `apps/*` e `packages/*` declarados mas não criados | F1, F5, F6 | Cada fase cria o pacote que preenche; nenhuma herda shell vazio |
| Guards `PreToolUse` ativos (prune, force push, segredo) | Todas | Limpeza Docker por label/prefixo deixa de ser convenção e vira caminho único |
| **Bind mount relativo do aluno resolve no host** (S3) — plano §8 e Apêndice B v1.6 item 1 | F2, F3 | F2: mount-espelho do job dir no próprio caminho absoluto (F2.4), comando canônico com caminho absoluto (F2.3), linha nova na tabela de decisões, edge case §10.16 acrescentado à matriz, `job-controller.test.ts` passa a travar os dois mounts. F3: F3.3 monta o comando canônico com o caminho absoluto, com a razão escrita |
| **Stack do aluno não carrega `fc.job=<id>`** (S3) — plano §8 e Apêndice B v1.6 item 2 | F2 | Linha nova na tabela de decisões da F2 explicitando que teardown e janitor varrem `fc.job=` **e** `com.docker.compose.project=`; F2.6 e F2.7 já faziam as duas varreduras, mas por coincidência, sem o porquê registrado |
| **D1 resolvida: `--allowedTools`**, e tool negada não trava a execução (S1) | F3 | Pré-condição da F3 marcada; F3.4 ganha a definição da allowlist real contra G1–G3 e a obrigação de o extrator devolver `permission_denials`, tratando array não-vazio como sinal |
| **D6 resolvida por (a)**: `session_id` sai da linha `init` do transcript e o `--resume` funciona (S1) | F3 | D6 da F3 reescrita: (a) validado ponta a ponta no CLI 2.1.224; (b) `--session-id` continua não testado e vira trabalho da fase, se ela quiser o caminho determinístico |
| **D5 não acionada** — o token em variável de ambiente funcionou, `~/.claude` não é montado (S1) | F2, F3 | Nenhuma mudança: §4, §8 e §11 seguem como estão. Registrado para que nenhuma sessão futura reabra a discussão sem motivo |
| Uid 1000 ocupado em `ubuntu:24.04`; gid do socket precisa ser injetado no build (S1, S3) | F2 | Registrado em `docs/spikes.md` ("O que a F2 e a F3 herdam") como receita para o `runner/Dockerfile` da F2.1 |
| `selftest.sh` passou de 20 para 31 verificações | — | Números corrigidos no aceite A3 e nas duas menções dentro desta fase |

## Registro de execução

- **Iniciada em:** 2026-08-07
- **Concluída em:** 2026-08-07
- **Manutenção pós-encerramento (2026-08-07), 2:** o scanner de segredo passou a exigir **32+
  caracteres** depois do prefixo `sk-ant-` para acusar chave, e o `selftest.sh` foi de 28 para 31
  verificações (item 8b: prefixo citado em prosa passa; atribuído a variável de chave, bloqueia).
  Motivo: o guard barrou o commit da própria F0 por causa de quatro linhas que **documentam** o
  formato do token — 6 caracteres depois do prefixo, contra ~100 de uma credencial real. A saída
  fácil seria apagar a documentação que evita repetir o `401 Invalid bearer token`; a certa era o
  guard aprender a diferença. As fixtures de chave falsa ganharam comprimento realista, senão não
  exercitariam a regra nova
- **Manutenção pós-encerramento (2026-08-07), 1:** `tests/skills-map.test.ts` passou a parsear o CSV
  conforme RFC 4180 em vez de `split(',')`, e ganhou teste de aspas desbalanceadas mais quatro do
  próprio parser. Motivo: blocos reais do admin da FC mostraram nome de desafio **com vírgula**
  (`Do compose ao cluster: Docker, Kubernetes e Terraform`). Como o casamento com o bloco colado é
  literal, trocar a vírgula por outro caractere garantiria que o par nunca casa — quem tinha que mudar
  era o formato do arquivo, não o dado. A F1.6 herdou a exigência de ler igual
- **Decisões tomadas:** Node 24 no host e Node 22 no runner (toolchain de aluno, §8) · pnpm 11.7.0 pinado · `apps/*`/`packages/*` declarados sem criar · hooks em `scripts/hooks/` (versionado, revisável em diff) e não em `.claude/hooks/` · prettier não formata markdown · `SKILLS_DIR` = `/home/pierry/fullcycle/.claude/skills` (49 skills) · o primeiro teste cobre o `skills-map.csv` em vez de ser placeholder. Nos spikes: **D1 = `--allowedTools Read,Write,Bash`** (`--dangerously-skip-permissions` não adotado) · **D2** artefatos versionados em `scripts/spikes/` · **D3** imagens descartáveis (`banca-spike-s1:dev`, `banca-spike-s3:dev`) · **D4** ids sintéticos `s1`/`s2a`/`s2b`/`s3` · **D5 não acionada** (o caminho primário do token funcionou) · **D6 sim, e verde**. Todas registradas em `docs/spikes.md` e `docs/STATUS.md`
- **Divergências do plano:** duas, ambas descobertas em bancada pelo S3 e absorvidas no **plano primeiro** (v1.6, Apêndice B) antes de tocarem em qualquer fase — (1) caminho relativo do compose do aluno resolve no host, exigindo mount-espelho do job dir no próprio caminho absoluto; (2) a stack do aluno não carrega o label do job, e sim `com.docker.compose.project`. As mudanças de escopo da própria F0 (vitest como entrega, guards executáveis, `INTEGRATION.md`) já tinham sido absorvidas antes do código — Apêndice B v1.2 itens 1–2 e v1.3 item 8. Divergências menores de execução, registradas aqui e em `docs/spikes.md`: o cliente HTTP de dentro do container no S2 é `wget` (busybox não traz `curl`), o compose do S3 é sintético (golden repos são §17.2), e o S3 ganhou um `Dockerfile` próprio que a lista de arquivos da etapa não previa — sem ele o stand-in do runner rodaria como root e não mediria a armadilha do gid do socket, que é justamente o que o §8 exige
- **Evidência dos aceites:** todos os oito verdes em 07/08/2026. **A1** `pnpm lint` exit 0. **A2** `pnpm test` 150 testes em 2 suites, 0 falhas. **A3** `pnpm guards` 31 verificações, 0 falhas. **A4** `banca-dev-db-1` `Up (healthy)`. **A5** S1: `claude -p` exit 0 sem interação, `out.json` com marcador literal e contagem corretos, transcript de 16 linhas com `session_id` e bloco de uso, `grep -c 'sk-ant'` = 0, `--resume` por `docker exec` reescrevendo a saída na mesma sessão. **A6** S2: `MARCADOR-S2A`/`MARCADOR-S2B` distintos e corretos, `docker port` vazio nos dois, 8080 do host livre. **A7** S3: `curl http://app:8080/` → `S3-APP-OK` de dentro do runner, zero porta publicada, zero container com nome fixo, zero recurso `fc.job=s3` após teardown. **A8** `docs/spikes.md` com os três vereditos, comandos reproduzíveis, saída literal sem token, decisões e o que F2/F3 herdam. Saída completa dos três roteiros reproduzível por `scripts/spikes/s{1,2,3}/run.sh`
