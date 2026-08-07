# Spikes da F0 — o que foi provado em bancada

Três riscos técnicos que o sistema inteiro assume como verdade, medidos antes de existir código de
produção (plan §13 F0, §15). Cada seção traz o objetivo, os comandos exatos, a saída literal
relevante (recortada e **sem token**), o veredito e a data.

Os spikes são reexecutáveis: os artefatos estão versionados em `scripts/spikes/` (decisão F0 D2),
justamente para poderem rodar de novo quando o Docker, o Compose ou o Claude Code CLI atualizarem.
Todos os recursos Docker nascem com id sintético no esquema `fc-job-<id>` (decisão F0 D4), para a
limpeza usar o mesmo caminho do janitor da F2 — nunca prune (regra dura 1).

| Spike | O que prova | Veredito | Data |
|---|---|---|---|
| S1 | `claude -p` headless em container, autenticado só por `CLAUDE_CODE_OAUTH_TOKEN` | ✅ verde | 07/08/2026 |
| S2 | Namespace de rede por container elimina colisão de porta | ✅ verde | 07/08/2026 |
| S3 | Compose de aluno sem portas publicadas, dentro de network externa pré-criada | ✅ verde | 07/08/2026 |

Ambiente observado em 07/08/2026 (WSL2, Ubuntu):

| Componente | Versão |
|---|---|
| Docker Engine | 29.1.2 |
| Docker Compose | v5.0.0 (≥ 2.24, então o caminho principal do S3 com `!reset` está liberado) |
| Node do host | v24.11.1 (`.nvmrc`) |
| Node do runner | 22.x (NodeSource) — toolchain de aluno, sem relação com a do host (§8) |
| pnpm | 11.7.0 |
| Claude Code CLI | 2.1.224 (dentro do runner, via `npm i -g @anthropic-ai/claude-code`) |
| Modelo usado no S1 | `claude-opus-5` — §14: modelo é fixado por run, e trocá-lo muda a régua |

---

## S1 — Claude Code headless dentro de container

**Objetivo em uma linha:** provar que `claude -p` roda do início ao fim sem nenhuma interação humana,
autenticado só por `CLAUDE_CODE_OAUTH_TOKEN`, lendo uma skill montada `:ro` e escrevendo um JSON —
com transcript capturado e a flag de permissão definida. É o risco nº 1 do projeto (§13, §15).

**Comandos:** `scripts/spikes/s1/run.sh [allowedTools|skip]`.

```
docker build -t banca-spike-s1:dev scripts/spikes/s1
docker run -d --name fc-job-s1 --label fc.job=s1 --user corrector \
  -v $JOBS_DIR/s1:/workspace -v $PWD/scripts/spikes/s1/skill:/workspace/skill:ro \
  --env-file <(grep '^CLAUDE_CODE_OAUTH_TOKEN=' .env) -e FC_JOB_ID=s1 \
  banca-spike-s1:dev sleep infinity
docker exec fc-job-s1 sh -c 'cd /workspace && claude -p "$(cat /workspace/prompt.txt)" \
  --model claude-opus-5 --allowedTools Read,Write,Bash \
  --output-format stream-json --verbose > /workspace/transcript.jsonl'
docker exec fc-job-s1 claude --resume <session_id> -p "<correção do validador>" ...
docker ps -aq --filter label=fc.job=s1 | xargs -r docker rm -f
```

A instrução da skill foi escolhida para ser **impossível de acertar por acaso**: contar as linhas de
um arquivo do workspace e copiar para o JSON uma frase-marcador que só existe dentro do `SKILL.md`
montado. Acertar as duas coisas prova que o agente leu o arquivo, e não que adivinhou.

**Saída literal:**

```
== S1.2 — runner de pé, com processo de longa duração como PID 1
uid=1000(corrector) gid=1000(corrector) groups=1000(corrector)
2.1.224 (Claude Code)

== S1.3 — invocação headless, sem nenhuma interação
  exit code do claude -p: 0

== S1.4 — o JSON de saída existe, é válido e bate LITERALMENTE com a skill montada
{
  "linhas_alvo": 7,
  "marcador_literal": "tordilho-42-sem-graxa: o pangaré confere o dossiê às quintas-feiras",
  "arquivo_lido": "/workspace/repo/ALVO.txt"
}
  marcador literal confere · contagem de linhas confere

== S1.5 — transcript stream-json parseável, com session_id e bloco de uso
  16 linhas, todas parseáveis
  session_id: 4f609746-8e89-41c5-94f1-970f6ea032e5

== S1.6 — nenhum vazamento de segredo no transcript (regra dura 5)
  grep -c 'sk-ant' transcript.jsonl -> 0

== S1.7 (D6) — retry corretivo: docker exec + claude --resume no container ainda vivo (§7)
  exit code do claude --resume: 0
{
  "linhas_alvo": 7,
  "marcador_literal": "tordilho-42-sem-graxa: o pangaré confere o dossiê às quintas-feiras",
  "arquivo_lido": "/workspace/repo/ALVO.txt",
  "retry_corretivo": true
}
  out.json reescrito na MESMA sessão, com o campo novo e os valores originais preservados
```

Bloco de uso da linha final do transcript, recortado (§15):

```
"total_cost_usd": 0.1367695,
"usage": { "input_tokens": 10, "cache_creation_input_tokens": 6677,
           "cache_read_input_tokens": 102505, "output_tokens": 719 },
"modelUsage": {
  "claude-opus-5":               { "inputTokens": 10,  "outputTokens": 719, "costUSD": 0.1360475 },
  "claude-haiku-4-5-20251001":   { "inputTokens": 617, "outputTokens": 21,  "costUSD": 0.000722 }
},
"permission_denials": [], "num_turns": 5, "duration_ms": 11455, "terminal_reason": "completed"
```

**Veredito: ✅ verde (07/08/2026).** O caminho primário do §4/§15 funciona: token de `setup-token`
como variável de ambiente, sem montar `~/.claude` do host. O fallback e a decisão **D5 não foram
acionados** — §4, §8 e §11 seguem como estão.

**D6 confirmada.** `docker exec` + `claude --resume <session_id>` no container ainda vivo reescreveu
o `out.json` na mesma sessão, com o campo novo e os valores originais intactos. O retry corretivo do
§7 é viável exatamente como o plano descreve — e o fato de o entrypoint não poder encerrar quando o
`claude -p` retorna (§8, v1.5 item 2) fica confirmado na prática, não só por dedução.

### D1 resolvida: `--allowedTools`, com uma ressalva

`--allowedTools Read,Write,Bash` passou de primeira, com `permission_denials: []`.
`--dangerously-skip-permissions` não foi necessário e **não é adotado** — vale a menor superfície,
já que o container continua sendo a fronteira de segurança (§8).

A ressalva importa mais que a decisão: **tool fora da lista não trava a execução**. Em `-p` não há
quem responda ao pedido de permissão, então a chamada é negada, o agente segue e a corrida termina
com exit 0 — a perda aparece só como entrada no array `permission_denials` do transcript. Uma skill
que precise de `Glob`, `Grep` ou `Edit` produziria uma correção pior sem nenhum erro no caminho.
Consequências, ambas registradas na F3:

- a allowlist tem que cobrir o que as skills realmente exigem, e é decisão da F3 (não deste spike);
- o Job Controller tem que **ler `permission_denials`** e tratar array não-vazio como sinal, não
  como detalhe de log.

### Uso e custo: o número que o §15 pedia

`total_cost_usd` **0,1368** para uma carga trivial — ler um arquivo de 7 linhas e escrever um JSON de
três campos. Duas leituras importantes:

- **O custo não vem do trabalho, vem do contexto**: 102.505 tokens de cache read e 6.677 de cache
  creation contra 719 de saída. É o system prompt do CLI, e ele é cobrado a cada correção
  independente do tamanho do desafio. Uma correção real soma o repo do aluno e a skill **por cima**
  desse piso.
- **O CLI usa um segundo modelo por conta própria**: `claude-haiku-4-5` aparece no `modelUsage` com
  617 tokens de entrada. Irrelevante no custo (US$ 0,0007), relevante para o §14 — "modelo fixado
  por run" descreve o modelo da correção, não tudo o que roda dentro do CLI.

No plano Max o valor não é cobrado em dólar; ele é o equivalente a preço de tabela, que é exatamente
o número que o §15 queria para embasar a conversa de API key. Medir de novo com um golden repo real
(F3) é o que dá a estimativa que serve para decidir.

**Onde ficaram os artefatos.** `$JOBS_DIR/s1/` — `transcript.jsonl` (16 linhas, formato real do CLI
2.1.224), `transcript-resume.jsonl`, `out.json` e `prompt.txt`. É o fixture que a F3 usa para o
extrator de `session_id`/`exit_code`; `scripts/spikes/s1/run.sh` regenera tudo, ao custo de uma
invocação.

**Nota de execução — armadilha do `setup-token`.** A primeira tentativa deu
`401 Invalid bearer token`. Não era o container: a variável chegou (verificado sem imprimir o valor)
e o CLI subiu. O que estava no `.env` era o **código que o navegador exibe no meio do fluxo**, não o
token que o `claude setup-token` imprime no fim. O token válido começa com `sk-ant-oat01-`; conferir
o prefixo antes de rodar economiza um ciclo inteiro de diagnóstico, e a pré-condição da F0 passou a
dizer isso.

---

## S2 — Isolamento de rede por container

**Objetivo em uma linha:** provar que dois runners servem na mesma porta 8080 ao mesmo tempo sem
colidir, e que cada um enxerga o próprio processo em `localhost:8080` (§2.4, §8, §10.13).

**Comandos:** `scripts/spikes/s2/run.sh` — dois `docker run` sem `-p` e sem `--network host`, cada um
servindo `httpd` na 8080 com um marcador próprio.

```
docker run -d --name fc-job-s2a --label fc.job=s2a busybox:1.36 \
  sh -c "... httpd -f -p 8080 -h /www"
docker exec fc-job-s2a wget -qO- http://localhost:8080/
docker port fc-job-s2a
curl -sf http://localhost:8080/           # do host
docker ps -aq --filter 'name=^fc-job-s2' | xargs -r docker rm -f
```

**Saída literal:**

```
== S2.2 — cada container enxerga o PRÓPRIO processo em localhost:8080
  fc-job-s2a -> MARCADOR-S2A
  fc-job-s2b -> MARCADOR-S2B

== S2.3 — nenhum dos dois publicou porta no host
  docker port fc-job-s2a -> ''
  docker port fc-job-s2b -> ''

== S2.4 — a 8080 do host continua livre
  curl http://localhost:8080/ do host -> falhou, como esperado

== S2.5 — teardown por prefixo, sem prune
  docker ps -a --filter 'name=^fc-job-s2' -> ''
```

**Veredito: ✅ verde (07/08/2026).** A premissa do §2.4 se sustenta: colisão de porta é impossível
por construção, não proibida por convenção. Não há alocação dinâmica de porta a implementar.

**Nota de execução:** o cliente HTTP de dentro do container é o `wget` do busybox, não `curl` — a
imagem não traz `curl`, e para o que o S2 mede (quem responde em `localhost:8080` dentro de cada
namespace) os dois são equivalentes.

---

## S3 — Compose sem portas publicadas + network externa

**Objetivo em uma linha:** provar a topologia exata do §8 — override gerado remove `ports:` e
`container_name:`, a network default aponta para uma externa criada **antes** do runner, e o runner
alcança o serviço por hostname (§10.14, §10.15, §10.16).

**Comandos:** `scripts/spikes/s3/run.sh`, na ordem obrigatória do Apêndice B (06/08) item 1.

```
docker build --build-arg DOCKER_GID=$(stat -c '%g' /var/run/docker.sock) -t banca-spike-s3:dev ...
scripts/spikes/s3/gera-override.sh <compose-aluno> fc-job-s3_net <saida>
docker network create --label fc.job=s3 fc-job-s3_net          # PRIMEIRO
docker run -d --name fc-job-s3 --label fc.job=s3 \
  -v <job_dir>:/workspace -v /var/run/docker.sock:/var/run/docker.sock banca-spike-s3:dev sleep infinity
docker network connect fc-job-s3_net fc-job-s3                 # e só então
docker exec -w /workspace fc-job-s3 docker compose -p fc-job-s3 -f compose-aluno.yml -f compose.override.yml up -d app db
docker exec fc-job-s3 curl -sf http://app:8080/
```

O compose do aluno é **sintético** (`scripts/spikes/s3/compose-aluno.yml`): não havia um desafio real
congelado ainda — os golden repos são pendência §17.2. Ele foi escrito como pior caso deliberado:
`ports:` e `container_name:` fixos em todos os serviços e um bind mount relativo. Quando a F7
congelar G1–G10, o gerador de override da F2 passa a ser exercitado contra compose real.

**Override gerado (nunca editado à mão):**

```yaml
# GERADO por scripts/spikes/s3/gera-override.sh — não editar à mão.
services:
  app:
    ports: !reset []
    container_name: !reset null
  db:
    ports: !reset []
    container_name: !reset null
  probe:
    ports: !reset []
    container_name: !reset null
networks:
  default:
    name: fc-job-s3_net
    external: true
```

**Saída literal:**

```
== S3.4 — o não-root fala com o daemon pelo socket montado (armadilha do gid, §8)
uid=1000(corrector) gid=1000(corrector) groups=1000(corrector),989(dockerhost)
29.1.2

== S3.6 — alcance por HOSTNAME de dentro do runner, nunca por porta de host
  curl http://app:8080/ -> S3-APP-OK

== S3.7 — zero porta publicada no host
NAME              IMAGE                COMMAND                  SERVICE   ...   PORTS
fc-job-s3-app-1   busybox:1.36         "sh -c 'mkdir -p /ww…"   app       ...
fc-job-s3-db-1    postgres:16-alpine   "docker-entrypoint.s…"   db        ...   5432/tcp
  docker port fc-job-s3-db-1 -> ''
  docker port fc-job-s3-app-1 -> ''
  a 8080 do host continua livre

== S3.8 — o container_name: fixo do aluno não pegou (§10.15)
  docker ps -a --filter name=^desafio-app$ -> ''
  docker ps -a --filter name=^desafio-db$ -> ''
  containers da stack:
    fc-job-s3-db-1
    fc-job-s3-app-1

== S3.9 — onde um bind mount relativo do aluno resolve (§10.16 / fixture G9)
  o compose resolveu o './dados' do serviço probe para: /workspace/dados
  esse caminho NÃO existe no host, onde o daemon está

== S3.10 — teardown em camadas e limpeza sem prune
  containers com label fc.job=s3 -> ''
  containers da stack fc-job-s3  -> ''
  networks com label fc.job=s3   -> ''
```

Repare na coluna `PORTS` do `db`: `5432/tcp` é porta **exposta** dentro da network do job, não
publicada no host — a forma publicada seria `0.0.0.0:5432->5432/tcp`. `docker port` vazio nos dois é
a prova de que nada saiu para o host.

**Veredito: ✅ verde (07/08/2026).** A topologia do §8 funciona exatamente como escrita: `!reset`
apaga `ports:` e `container_name:` (o plano B de gerar um compose derivado não foi necessário), a
stack nasce dentro da network externa pré-criada, e o acesso é por hostname de serviço.

### Dois achados que mudaram o §8

Nenhum dos dois quebra o S3 — os dois quebrariam a F2 em silêncio, que é pior. Ambos foram absorvidos
no plano antes de a F2 começar (Apêndice B v1.6).

**1. Caminho relativo do aluno resolve no host, não no runner (§10.16 confirmado).** O compose
resolveu `./dados` para `/workspace/dados` e mandaria esse caminho ao daemon do host, onde ele não
existe. O daemon não recusa: cria um diretório vazio e monta ele. A stack subiria, o serviço do aluno
rodaria sem os arquivos dele, e a correção avaliaria um ambiente que não é o do aluno — sem nenhum
erro no caminho. **Correção:** o job dir passa a ser montado também no próprio caminho absoluto,
idêntico dos dois lados, e o comando canônico de compose no prompt usa esse caminho. `/workspace`
segue sendo o caminho estável do que é do sistema (skill, `_shared`, dossiê, transcript).

O serviço `probe` do compose sintético existe só para essa observação e **não é subido** pelo
`run.sh`: subir de verdade faria o daemon criar `/workspace` no raiz do host, lixo que só sai com
root. A evidência veio de `docker compose config`, que mostra o caminho já resolvido.

**2. A stack do aluno não carrega o label do job.** Quem cria esses containers é o compose, que
rotula com `com.docker.compose.project=fc-job-<id>` e não com `fc.job=<id>`. Teardown e janitor
precisam varrer os dois; varrer só o label do job deixaria a stack inteira órfã, e a regra dura 1
fecha a saída fácil de limpar com prune. O prefixo de nome `fc-job-`, que o §3 já usava, pega os
dois — mas quem escrever a varredura por label precisa saber disso.

---

## Decisões que saíram dos spikes

| # | Decisão | Origem |
|---|---|---|
| D1 | **`--allowedTools Read,Write,Bash`** — `--dangerously-skip-permissions` não adotado | S1, verde de primeira, `permission_denials: []`. Ressalva: tool fora da lista é negada em silêncio, não trava — ver a seção do S1 |
| D5 | **Não acionada.** O caminho primário (token em variável de ambiente) funcionou; `~/.claude` do host não é montado e §4/§8/§11 seguem como estão | S1 |
| D2 | Artefatos dos spikes versionados em `scripts/spikes/` | tomada antes de rodar; confirmada na prática — o S3 foi reexecutado várias vezes durante o ajuste |
| D3 | Imagens dos spikes são descartáveis (`banca-spike-s1:dev`, `banca-spike-s3:dev`) | a F2 escreve o `runner/Dockerfile` do §8 do zero e herda só os aprendizados abaixo |
| D4 | Ids sintéticos `s1`, `s2a`, `s2b`, `s3` no esquema `fc-job-<id>` | limpeza pelo mesmo mecanismo do janitor, sem exceção à regra dura 2 |
| — | Formato do override do S3: tag `!reset` | funcionou no Compose v5.0.0; o plano B (compose derivado) não foi necessário |

## O que a F2 e a F3 herdam

**Provado, pode ser assumido:**

- `claude -p` roda headless em container autenticado só por `CLAUDE_CODE_OAUTH_TOKEN`, lê skill
  montada `:ro` e escreve arquivo no job dir (S1) — o caminho primário do §4/§15, sem fallback.
- `docker exec` + `claude --resume <session_id>` funciona no runner ainda vivo (S1) — o retry
  corretivo do §7 é implementável como o plano descreve, e o entrypoint que não encerra (§8, v1.5
  item 2) está confirmado na prática.
- `--output-format stream-json --verbose` produz JSONL parseável linha a linha, com `session_id` na
  linha `init` e bloco de uso/custo na linha `result` (S1) — é daí que saem o `--resume` e a métrica
  do §12.
- Netns por container elimina colisão de porta (S2) — a F2 não precisa de alocação dinâmica de porta.
- `!reset` remove `ports:` e `container_name:` no Compose v5.0.0 (S3) — é o formato que o gerador da
  F2.3 deve produzir.
- Network externa criada antes do runner, com o runner conectado depois do create e antes do start,
  entrega a stack dentro da network do job (S3) — a ordem da F2.4 está validada.
- Teardown em camadas por label/prefixo limpa tudo, sem prune (S2 e S3).
- **`ubuntu:24.04` já ocupa o uid 1000 com o usuário `ubuntu`**: sem `userdel -r ubuntu` antes, o
  `useradd -u 1000 corrector` do §8 falha. Vale para o `runner/Dockerfile` da F2.1.
- **O gid do grupo `docker` do host tem que ser injetado no build** (`--build-arg DOCKER_GID=$(stat
  -c '%g' /var/run/docker.sock)`, 989 nesta máquina): sem isso o usuário não-root leva permission
  denied ao falar com o daemon, e o erro não parece de permissão. Confirmado funcionando no S3 com
  `groups=1000(corrector),989(dockerhost)`.

**Restrições de entrada novas (as duas mudaram o §8, Apêndice B v1.6):**

- O job dir é montado **duas vezes**: em `/workspace` e no próprio caminho absoluto. O comando
  canônico de compose usa o caminho absoluto (F2.3, F2.4, F3.3).
- Teardown e janitor varrem `fc.job=<id>` **e** `com.docker.compose.project=fc-job-<id>` (F2.6, F2.7).

- **A allowlist de tools é `Read,Write,Bash`** e a F3 pode ampliá-la; o Job Controller lê
  `permission_denials` do transcript, porque tool negada não gera erro (S1).

**Continua em aberto:**

- **Que tools as skills reais exigem.** `Read,Write,Bash` bastou para a carga sintética do S1; uma
  correção de verdade provavelmente pede `Glob`, `Grep` e `Edit`. Decisão da F3, com os golden repos
  na frente — e o custo de errar é uma correção pior sem erro nenhum no caminho.
- Compose de aluno **real**: o S3 rodou contra um compose sintético. Os golden repos (§17.2) são o
  que fecha essa lacuna, na F3 (G1–G3) e na F7 (G1–G10).
- **Consumo de uma correção de verdade.** O S1 deu o piso (US$ 0,137 de contexto do CLI, antes de
  qualquer trabalho); o número que decide a conversa de API key sai de rodar um golden repo na F3.
- Paralelismo real: S2 e S3 rodaram um job de cada vez. O cenário de 4 jobs em paralelo é aceite da
  F2 e depende do `.wslconfig` (§17.4).
