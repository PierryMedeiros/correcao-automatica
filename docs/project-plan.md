# Banca — Plano de Projeto

Sistema de correção assistida por IA para desafios de alunos da Full Cycle.

- Versão: 1.0 — Agosto/2026
- Nome-código: "Banca" (a banca que corrige). Provisório; trocar depois é um find-replace.
- Status: documento vivo. Mudança de arquitetura passa por aqui antes de virar código.
- Localização: `docs/project-plan.md`.

---

## 1. Objetivo e escopo

Transformar o fluxo atual (Claude Code manual, copiar/colar desafio por desafio, colar devolutiva por devolutiva) em um sistema com fila, correção autônoma por desafio, revisão humana configurável e envio com um clique.

Metas do MVP:

1. O papel humano se reduz a: colar desafios no intake, revisar devolutivas e clicar em enviar.
2. Suportar o volume atual (~50 desafios/dia) com folga para crescer.
3. Zero perda de correção: toda submissão termina em um estado terminal conhecido, com retry e recuperação automática de falhas.
4. Rastreabilidade total: cada correção guarda dossiê estruturado, transcript completo da sessão do agente e trilha de auditoria de quem revisou/enviou.

Não-objetivos do MVP (ficam para fases pós-aprovação):

- Login e multiusuário.
- Deploy web (roda na máquina local, WSL2).
- Integração ativa com a plataforma FC (endpoints/webhook) — fica pré-plugável.
- Envio automático real para qualquer plataforma (no MVP, enviar = copiar texto + marcar como enviada).

## 2. Princípios de arquitetura

1. **Orquestração é código, não LLM.** Numerar, enfileirar, paralelizar, esperar, persistir, agregar alertas e limpar são tarefas determinísticas do backend.
2. **Um LLM por correção, stateless.** Cada correção é uma invocação nova do Claude que nasce, corrige um único desafio, escreve o dossiê e morre. Ninguém acumula contexto de 100 desafios.
3. **A skill é a única fonte de critérios.** O prompt do corretor não duplica critério de correção; ele aponta para a skill e define conduta (executar de verdade, dossiê honesto, etc.).
4. **Isolamento por construção, não por obediência.** Namespace de rede por job (runner container), portas despublicadas nos composes, project name único, labels por job. Colisão de porta vira impossível, não proibida.
5. **Nada destrutivo global.** `cleanDocker.sh` aposentado. Teardown é por job; um janitor remove órfãos por label/prefixo. `docker system prune` não existe no vocabulário do sistema.
6. **Contrato de dados entre agente e sistema.** O agente entrega `dossie.json` validado contra JSON Schema. O backend nunca interpreta prosa.
7. **Humano no loop configurável, com trava de segurança.** A política do run define o caminho feliz (revisar todas / só reprovadas / nenhuma). Dossiê com dúvidas, veredito inconclusivo ou gatilho disparado **sempre** vai para revisão humana, independente da política.
8. **Perder correção é bug.** Retry com limite, timeout, recuperação de órfãos no boot, pausa automática quando o limite do plano é atingido.
9. **Tudo auditável.** Transcript por correção, tabela de eventos append-only, texto do agente vs. texto final editado, quem enviou e quando.
10. **Pré-plugável sem depender do desconhecido.** Drivers de origem/envio por trás de interfaces; `INTEGRATION.md` registra o que não sabemos da API da FC; receptor de webhook dormante já existe para capturar payloads reais quando liberarem.

## 3. Arquitetura

```
[SPA Vue] ⇄ REST + SSE ⇄ [API NestJS] ⇄ [Postgres]
                              │
                         [pg-boss (fila, cron)]
                              │  N workers (concorrência do run)
                       [Job Controller]
                              │ docker run (1 container por correção)
                    ┌─────────┴──────────┐
                    │ runner fc-job-<id> │  ← rede própria (netns), labels fc.job=<id>
                    │  claude -p + skill │
                    │  clone /workspace  │
                    └─────────┬──────────┘
                              │ socket do host (stacks de compose dos alunos)
                    [stacks compose -p fc-job-<id>, sem ports publicadas]

[Janitor (cron pg-boss)]  [Backup (cron pg-boss)]  [POST /webhooks/fc (dormante)]
```

Componentes:

- **SPA (Vue)** — telas de intake, dashboard/fila, revisão, prontas para envio, histórico, notificações. Recebe atualizações por SSE.
- **API (NestJS)** — REST + SSE, máquina de estados das submissões, validação do dossiê, políticas de revisão, gatilhos programáticos, notificações.
- **Fila (pg-boss)** — jobs de correção com retry/backoff/timeout, jobs cron (janitor, backup), pausa global.
- **Job Controller** — cria o diretório do job, sobe o runner container com mounts e limites, acompanha, coleta `dossie.json` + transcript, garante teardown.
- **Runner (imagem própria)** — ambiente onde o agente corrige: Claude Code CLI, git, docker CLI + compose plugin, toolchains (Go, Node, PHP+Composer, Python). Detalhes no §8.
- **Janitor** — remove containers/redes/volumes órfãos por prefixo `fc-job-`, poda imagens dangling e cache de build antigos, apaga job dirs velhos, monitora disco.
- **Webhook receptor dormante** — `POST /webhooks/fc` que só grava o payload bruto em `webhook_payloads`. Quando a equipe da plataforma liberar, olhamos payloads reais antes de escrever o driver.
- **Drivers** — `OrigemDriver` (manual | fc_platform) e `EnvioDriver` (manual/copy | fc_platform). No MVP só os manuais funcionam; as interfaces já existem.

## 4. Stack e justificativas

| Camada | Escolha | Por quê | Alternativa aceitável |
|---|---|---|---|
| Front | Vue 3 + Vite + Pinia + Vue Router | Stack que o Pierry domina; reatividade para dashboard ao vivo | — |
| UI kit | PrimeVue | DataTable com filtro/ordenação pronta (histórico), componentes de formulário | Naive UI |
| Backend | NestJS 11 + TypeScript | Estrutura de módulos/DI familiar a quem vem de Laravel (o time), SSE nativo, cresce bem para auth/drivers | Fastify puro |
| ORM | Prisma | Migrations + DX; jsonb suportado; extensões via SQL cru | Drizzle |
| Banco | Postgres 16 | jsonb para dossiê, `pg_trgm` para similaridade de devolutivas | — |
| Fila | pg-boss | Retry, backoff, timeout, cron e pausa sobre o próprio Postgres; zero infra extra (sem Redis) | BullMQ + Redis |
| Tempo real | SSE | Unidirecional basta (servidor → UI); mais simples que WebSocket | WebSocket |
| Execução LLM | Claude Code headless (`claude -p`) dentro do runner | Funciona hoje no plano Max; trocar para API key da empresa = trocar variável de ambiente | Claude Agent SDK (refactor futuro) |
| Auth do agente | `CLAUDE_CODE_OAUTH_TOKEN` gerado por `claude setup-token` (token de ~1 ano, atrelado à assinatura Pro/Max, feito para CI/containers) | Documentado para ambientes headless; evita montar credenciais de sessão no container | Montar `~/.claude` do host (fallback, validar no S1) |
| Monorepo | pnpm workspaces | `apps/web`, `apps/api`, `packages/shared`, `runner/` | Turborepo se crescer |

Referências oficiais usadas: `code.claude.com/docs/en/headless` (modo headless, `--output-format text|json|stream-json`, sendo que `stream-json` exige `--verbose`) e `code.claude.com/docs/en/authentication` (`claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN` para pipelines/containers com assinatura).

Layout do repositório:

```
banca/
  apps/web/          # Vue
  apps/api/          # NestJS
  packages/shared/   # tipos TS, JSON Schema do dossiê, parser de bloco
  runner/            # Dockerfile, entrypoint.sh, prompt-template.md
  skills-correcao/   # as ~50 skills corrige-* (ou symlink/submódulo da pasta atual)
  docs/              # project-plan.md, INTEGRATION.md, spikes.md, runbook.md, decisions.md
  scripts/           # utilitários de dev
  compose.yaml       # Postgres de desenvolvimento
```

## 5. Modelo de dados

Convenção: `snake_case`, timestamps `created_at/updated_at` em tudo, ids `bigint` autoincrement (ids internos não vazam para aluno).

**skills_map** — resolve desafio → skill, sem LLM.

| Campo | Tipo | Nota |
|---|---|---|
| projeto | text | ex.: "GoLang" |
| fase | text | ex.: "Client-Server-API"; UNIQUE(projeto, fase) |
| skill_slug | text | nome da pasta da skill `corrige-*` |
| modo_avaliacao | enum: execucao, estatica | copiado da skill; o sistema confere coerência com o dossiê |
| base_repo_url | text null | repo base/template do desafio; usado para detectar aluno que colou o link do template e para o delta de lint/testes |
| timeout_s | int null | override do timeout padrão do job (1500s) para desafios pesados |
| ativo | bool | desativar sem deletar |

**submissoes** — uma entrega de aluno.

| Campo | Tipo | Nota |
|---|---|---|
| origem | enum: manual, fc_platform | feature definitiva, não gambiarra (§9.1) |
| external_id | text null | id da plataforma FC quando houver |
| run_id | fk runs null | lote em que foi processada |
| aluno_nome, aluno_email | text | celular **não é persistido** (privacidade) |
| projeto, fase | text | chaves do lookup em skills_map |
| skill_slug | text null | resolvida no intake; para origem manual pode ser escolhida à mão |
| repo_url | text | |
| commit_sha | text null | pinado no intake via `git ls-remote <url> HEAD`; a correção faz checkout nesse SHA |
| attempt_aluno | int default 1 | tentativa do aluno neste desafio (não confundir com retry do sistema) |
| anterior_id | fk submissoes null | tentativa anterior do aluno, se houver |
| status | enum (§6) | |
| status_detalhe | text null | motivo humano-legível (ex.: "repo privado", "link do repositório base") |

Índice único parcial: (aluno_email, projeto, fase) WHERE status em estados ativos — garante que só existe uma submissão ativa por aluno+desafio (a nova substitui a antiga, §10 caso 5).

**correcoes** — uma execução do agente sobre uma submissão (pode haver mais de uma por retries/reprocessamento).

| Campo | Tipo | Nota |
|---|---|---|
| submissao_id | fk | |
| retry_n | int | 1..3 (retry do sistema) |
| status | enum: rodando, concluida, falhou, timeout, nao_executada | `nao_executada` = pausa global/limite; não conta como retry |
| veredito | enum null: aprovado, aprovado_com_observacao, reprovado, inconclusivo | `inconclusivo` = agente não conseguiu decidir (ex.: repo não bate com a skill); força revisão humana |
| dossie | jsonb null | validado contra o schema (§7) |
| gatilhos | text[] | programáticos + autorrelatados (§12) |
| modelo | text | modelo usado neste run |
| duracao_s, started_at, finished_at | | |
| transcript_path | text | caminho do `transcript.jsonl` no job dir |
| exit_code | int null | do `claude -p` |
| erro_resumo | text null | quando falhou |

**devolutivas** — o texto que vai para o aluno.

| Campo | Tipo | Nota |
|---|---|---|
| submissao_id | fk | a vigente é a da correção mais recente; reprocessar cria nova linha e a anterior fica no histórico (auditoria) |
| correcao_id | fk | correção que originou o rascunho |
| texto_agente | text | rascunho original (imutável) |
| texto_final | text | editável pelo revisor; começa igual ao rascunho |
| veredito_final | enum | revisor pode divergir do agente (humano é a autoridade) |
| enviada_em, enviada_por | | `enviada_por` null no MVP (sem login) |

**runs** — um lote de correção com configuração.

| Campo | Tipo | Nota |
|---|---|---|
| modelo | text | passado como `--model` ao CLI |
| max_paralelo | int | default 2, teto 4 (com aviso na UI, §8) |
| politica_revisao | enum: todas, so_reprovadas, nenhuma | "nenhuma" = caminho feliz vai direto para `pronta_envio`; a trava do §2.7 vale sempre |
| status | enum: ativo, pausado, finalizado, cancelado | MVP: no máximo 1 run ativo por vez |

**Demais tabelas** (campos óbvios omitidos): `eventos` (auditoria append-only: submissao_id, tipo, payload jsonb, ts), `notificacoes` (tipo, texto, lida, link), `webhook_payloads` (headers, body bruto, ts), `config` (chave/valor: pausa_global, template de devolutiva de link inválido, limiares de disco, retenções).

## 6. Máquina de estados da submissão

Estados: `recebida → validando → na_fila → corrigindo → aguardando_revisao → pronta_envio → enviada`, com terminais/desvios `link_invalido`, `sem_skill`, `erro`, `cancelada`, `substituida`.

| De | Para | Gatilho | Quem |
|---|---|---|---|
| recebida | validando | automático: a confirmação do preview cria a submissão já em `recebida` e dispara a validação | API |
| validando | link_invalido | `git ls-remote` falhou 2× (timeout 30s cada) OU repo_url == base_repo_url da skill | API |
| validando | sem_skill | (projeto, fase) sem match no skills_map e sem skill manual escolhida | API |
| validando | na_fila | ls-remote ok + skill resolvida + SHA pinado | API |
| na_fila | corrigindo | worker pegou o job, runner subiu | Worker |
| corrigindo | aguardando_revisao | dossiê válido E (política=todas OU veredito=reprovado com política=so_reprovadas OU dúvidas≠∅ OU gatilho disparado OU veredito=inconclusivo) | API |
| corrigindo | pronta_envio | dossiê válido, caminho feliz da política permite pular revisão | API |
| corrigindo | na_fila | falha/timeout com retry_n < 3; ou correção `nao_executada` (pausa global — volta sem consumir retry) | Worker |
| corrigindo | erro | falha na 3ª correção | Worker |
| aguardando_revisao | pronta_envio | revisor aprovou (com ou sem edição/mudança de veredito) | Humano |
| aguardando_revisao / erro / sem_skill | na_fila | botão "reprocessar" (cria nova correção; zera contagem de retry; em `sem_skill`, exige skill mapeada ou escolhida antes) | Humano |
| pronta_envio | enviada | origem manual: clique "copiar e marcar enviada"; origem fc_platform (futuro): driver postou com sucesso | Humano / Driver |
| link_invalido | enviada | clique "copiar devolutiva padrão e marcar enviada" | Humano |
| qualquer não-terminal | cancelada | botão cancelar (se `corrigindo`, mata o runner e faz teardown) | Humano |
| qualquer não-terminal | substituida | nova entrega do mesmo aluno+projeto+fase chegou (se `corrigindo`, mata o runner; nada é enviado) | API |

Regras transversais: `link_invalido` gera devolutiva a partir de template global do sistema (configurável), sem gastar agente — o motivo (privado, inexistente, link do template) entra no texto — e fica aguardando o envio dela pela transição própria acima. `sem_skill` aguarda ação humana: mapear/escolher a skill e reprocessar, ou cancelar. `sem_skill` e `erro` geram notificação. Terminais de fato: `enviada`, `cancelada`, `substituida`. O histórico mostra tudo.

## 7. Contrato do dossiê (dossie.json)

O agente escreve `/workspace/dossie.json` como último ato. O backend valida contra JSON Schema versionado em `packages/shared/dossie.schema.json`.

```jsonc
{
  "schema_version": 1,
  "veredito": "aprovado | aprovado_com_observacao | reprovado | inconclusivo",
  "motivo_inconclusivo": "string | null",       // obrigatório se inconclusivo
  "modo_avaliacao": "execucao | estatica",      // o que o agente efetivamente aplicou
  "execucao": {
    "executou": true,
    "comandos_docker": ["docker compose -p fc-job-123 ..."],
    "compose_project": "fc-job-123 | null",
    "teardown_ok": true,
    "container_name_fixo_no_compose": false,
    "arquivos_auxiliares": [".env criado a partir do .env.example"],
    "observacoes": "string | null"
  },
  "criterios": [
    {
      "nome": "string",                          // como a skill nomeia
      "resultado": "ok | falha | nao_verificado",
      "como_verificou": "executou | leu",
      "evidencia": "saída literal, arquivo:linha, contagem"  // obrigatória e não-vazia se resultado=falha
    }
  ],
  "delta_base": {                                // null se não aplicável
    "base_ref": "string",
    "numeros": { "lint_base": 0, "lint_aluno": 0, "testes_base": "…", "testes_aluno": "…" }
  },
  "duvidas": [ { "tema": "string", "lado_aprovar": "string", "lado_reprovar": "string" } ],
  "devolutiva_rascunho": "string",               // no formato que a skill exige
  "historico_nao_avaliado": false                // true quando o clone caiu no fallback shallow (§9.2)
}
```

Validações do backend além do schema: `reprovado` exige ≥1 critério `falha` com evidência não-vazia; `modo_avaliacao` do dossiê deve bater com o `skills_map` (divergência = gatilho); `execucao.executou=false` com skill de modo `execucao` = gatilho.

Falha de validação (JSON inválido, campo faltando): **1 retry corretivo** dentro da mesma correção — o Job Controller reinvoca o agente na mesma sessão (`docker exec` no runner ainda vivo + `claude --resume <session_id>`) com a mensagem de erro do validador; o teardown só acontece depois. Esse retry corretivo não incrementa `retry_n`. Se falhar de novo, a correção falha e aí sim consome retry do job.

## 8. Runner: o ambiente de cada correção

Um container por correção, nome `fc-job-<id>`, label `fc.job=<id>`.

**Imagem** (`runner/Dockerfile`, base Ubuntu 24.04): git, curl, jq, docker-ce-cli + docker-compose-plugin, Node 22 (NodeSource), Go (tarball, versão pinada), PHP 8.3 + Composer, Python 3.12 + pip, Claude Code CLI (`npm i -g @anthropic-ai/claude-code`). Usuário não-root `corrector` (uid 1000) no grupo `docker` com o gid do socket do host injetado no build. Versões pinadas no Dockerfile; ajustar conforme skills exigirem (desafios que buildam via Docker do próprio aluno não dependem da toolchain do runner).

**Como o container sobe** (Job Controller):

```
docker run -d --name fc-job-<id> \
  --label fc.job=<id> \
  --cpus 2 --memory 2.5g \
  -v <job_dir>:/workspace \
  -v <skills_dir>/<skill_slug>:/workspace/skill:ro \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e CLAUDE_CODE_OAUTH_TOKEN=*** -e FC_JOB_ID=<id> \
  banca-runner:<tag>
```

- **Rede**: o runner nasce na bridge default (egress para dependências e APIs externas dos enunciados) e é conectado também à `fc-job-<id>_net` (abaixo). O namespace de rede é próprio: `localhost:8080` dentro dele é só dele — N correções do mesmo desafio de processo direto (ex.: Client-Server-API) coexistem.
- **Stacks de compose** dos alunos sobem no daemon do host (socket montado) com `-p fc-job-<id>` e um override gerado pelo sistema que (a) remove `ports:` e `container_name:` de todos os serviços (evolução do `fc-compose-noports.sh`) e (b) aponta a network default do compose para uma network externa `fc-job-<id>_net`, criada pelo Job Controller **antes** de subir o runner. Essa sequência elimina a corrida: a network nasce primeiro, o runner é conectado a ela na criação, e a stack — subida depois, pelo agente, com o comando canônico fornecido pronto no prompt — já nasce dentro dela. O agente alcança os serviços por hostname do compose (`curl http://app:8080`), nunca por porta de host.
- **Autonomia**: dentro do runner o agente é instruído: "você está sozinho nesta máquina; porta ocupada é processo seu, resolva à vontade; nunca mate processo que você não criou" (cinto e suspensório — por construção não há vizinhos no netns dele).
- **Invocação**: `claude -p "$(cat prompt.txt)" --model <modelo_do_run> --output-format stream-json --verbose > /workspace/transcript.jsonl`, com permissões liberadas para execução não-assistida (flag exata — `--dangerously-skip-permissions` vs. modo `--bare` + `--allowedTools` — é decisão do Spike S1). O container é a fronteira de segurança, não a permissão do CLI.
- **Skill**: montada RO em `/workspace/skill`; o prompt manda ler `/workspace/skill/SKILL.md` primeiro e seguir literalmente (inclusive `devolutivas.md` e demais arquivos citados por ela). Não dependemos da descoberta automática de skills em modo headless — funciona com o tool Read, que sempre existe.
- **Teardown em camadas**: (1) o agente roda `docker compose -p fc-job-<id> down -v` ao final; (2) o Job Controller sempre executa `docker compose -p fc-job-<id> down -v --remove-orphans`, desconecta e remove networks, remove o runner — mesmo em timeout/kill; (3) o janitor pega o que sobrar por prefixo/label.
- **Limites**: runner com `--cpus 2 --memory 2.5g`. Stacks de aluno sem cap no MVP (risco aceito e documentado; duração anômala vira gatilho). Starts com jitter de 5–15s para não sincronizar tempestade de `npm install`.
- **Concorrência**: dois limites existem conceitualmente (agentes Claude vs. stacks Docker), mas como runner = job, um único knob resolve: `max_paralelo` do run. Default 2, teto 4 com aviso (i5-12400F, WSL com 6 vCPU/10GB — ver §12 runbook).

## 9. Fluxos principais

### 9.1 Intake manual (feature definitiva, não paliativo)

Serve a plataforma FC (enquanto não há endpoints) e a segunda plataforma de cursos da empresa (que terá sempre intake manual, por volume baixo).

- **Colar bloco**: textarea onde se cola o cabeçalho da página de detalhe da entrega (o bloco "Projeto / Fase do projeto / Repositório / Aluno / E-mail" do admin). O parser (`packages/shared`) reconhece rótulos `Projeto:`, `Fase do projeto:`/`Fase:`, `Repositório:`, `Aluno:`, `E-mail:`/`Email:`, `Id:` (opcional → external_id), `Criado em:` (opcional); uma nova ocorrência de `Projeto:` abre novo bloco, permitindo colar vários de uma vez; `Celular:` é reconhecido e descartado (não persiste). Tolerante a ordem e a rótulos desconhecidos; extrai URL por regex como fallback.
- **Preview obrigatório**: tabela editável com os blocos parseados, validações por linha (URL git plausível, e-mail válido, projeto+fase existe no skills_map). Par sem skill aparece marcado, com dropdown para escolher skill manualmente (caminho da segunda plataforma) ou deixar seguir como `sem_skill`. Duplicata de submissão ativa é avisada aqui. Nada entra sem confirmação.
- **Config do run** na mesma tela: modelo, `max_paralelo`, política de revisão. Botão iniciar.
- O botão "Buscar desafios em aberto (FC)" já existe na UI, desabilitado com aviso "aguardando integração" — vira o driver `fc_platform` na F9.

### 9.2 Pipeline de uma correção (caminho feliz)

1. Validação: `git ls-remote <url>` (timeout 30s, 2 tentativas); compara com `base_repo_url`; pina `commit_sha` (HEAD).
2. Resolve skill via skills_map (ou usa a manual). Enfileira no pg-boss com prioridade FIFO.
3. Worker pega o job → Job Controller cria `job_dir` em `~/banca-jobs/<id>/` e escreve nele o `prompt.txt` (montado de `runner/prompt-template.md` + dados do job: aluno, desafio, skill, SHA, comando canônico de compose com `-p` e override, contexto de tentativa anterior se houver) e o override noports gerado; cria a network `fc-job-<id>_net`; sobe o runner (§8) e o conecta a ela.
4. Entrypoint do runner: clona o repo em `/workspace/repo` (clone completo, timeout 120s; se falhar por tamanho, fallback `--depth 1` e marca `historico_nao_avaliado` — skills com critério de Git Flow precisam de histórico); `git checkout <commit_sha>`; `--recurse-submodules` tolerante a falha; invoca o `claude -p` com o `prompt.txt`.
5. Agente segue a skill: executa de verdade (ou análise estática, se a skill assim define), exercita caminho crítico, investiga ambiente vs. aluno, mede delta contra o base quando aplicável, escreve `dossie.json`.
6. Job Controller detecta o fim, valida o dossiê (com retry corretivo, §7), roda o teardown, persiste correção + transcript + devolutiva-rascunho, aplica gatilhos programáticos (§12), aplica a política de revisão, emite SSE.

### 9.3 Revisão humana

Card por submissão: veredito e devolutiva (editável, com rascunho original preservado), dossiê expandível por seção (execução, critérios com evidência, dúvidas, delta base), badges de gatilho, link para o transcript, ações: aprovar para envio (podendo trocar o veredito — o humano é a autoridade), reprocessar, cancelar. Toda ação vira linha em `eventos`.

### 9.4 Envio

Por origem. `manual`: botão "copiar devolutiva" (texto puro) + "marcar como enviada" — comportamento definitivo dessa origem, não gambiarra. `fc_platform` (F9): driver posta status + feedback no endpoint da FC e marca enviada; em falha do driver, volta para `pronta_envio` com notificação.

### 9.5 Nova tentativa do aluno

Match automático por (aluno_email, projeto, fase) contra a submissão anterior `enviada` (qualquer veredito — na prática quase sempre reprovado) → `attempt_aluno = n+1`, `anterior_id` preenchido. O prompt da nova correção recebe a devolutiva anterior e os pontos reprovados, com a instrução: os critérios não mudam (a skill segue sendo a régua), mas verifique nominalmente se cada ponto apontado foi resolvido e calibre o tom/nível de dica da devolutiva pela história do aluno. Se a anterior ainda estiver **ativa** (não enviada), a nova a substitui (§6).

## 10. Edge cases e comportamento definido

| # | Caso | Comportamento |
|---|---|---|
| 1 | Repo 404/privado/inacessível | `link_invalido` após 2 tentativas de ls-remote; devolutiva por template global com o motivo; sem agente |
| 2 | Aluno colou o link do repo base do desafio | `link_invalido` (motivo específico no template); detecção por igualdade com `base_repo_url` |
| 3 | (projeto, fase) sem skill | `sem_skill` + notificação; origem manual pode resolver no preview escolhendo skill |
| 4 | Aluno dá push após o intake | Irrelevante: checkout no SHA pinado; devolutiva pode citar o SHA avaliado |
| 5 | Nova entrega com a anterior ainda ativa | Anterior → `substituida` (se corrigindo: mata runner + teardown, nada enviado); nova entra na fila |
| 6 | Reenvio após reprovação enviada | §9.5: attempt_aluno+1, contexto da devolutiva anterior no prompt |
| 7 | Dossiê ausente/JSON inválido | 1 retry corretivo via `--resume` (§7); persistindo, a correção falha e consome retry do job |
| 8 | Veredito `inconclusivo` (ex.: repo não corresponde à skill) | Sempre `aguardando_revisao`, destacado; humano decide |
| 9 | Timeout do job (default 25 min = 1500s; `timeout_s` por skill) | Mata runner, teardown, re-execução até o limite de 3 execuções totais (`retry_n` ≤ 3); depois `erro` com transcript preservado |
| 10 | Limite do plano Max / rate limit | Worker detecta pelo erro do CLI → pausa global automática + notificação; correção marcada `nao_executada` (não consome retry); fila retoma sozinha após intervalo com retry escalonado |
| 11 | `CLAUDE_CODE_OAUTH_TOKEN` expirado/revogado | Mesmo tratamento do 10, com notificação específica ("rode claude setup-token e atualize o .env") |
| 12 | Reboot/queda no meio | No boot: correções `rodando` órfãs são marcadas `falhou` ("órfã pós-reinício") e as submissões voltam a `na_fila` (consome retry, evita loop infinito); janitor limpa containers órfãos |
| 13 | N correções do mesmo desafio de porta fixa (8080 direto no processo) | Sem conflito por construção: netns por runner |
| 14 | Compose do aluno publica portas fixas | Override remove `ports:`; acesso por hostname de serviço via network do job |
| 15 | `container_name:` fixo no compose | Override remove; registrado no dossiê |
| 16 | Bind mount + `lint --fix` reescreve arquivos do aluno | Regra de prompt (linter em modo leitura; `git status` ao final; restaurar se sujou); sujeira não vaza (sem push), mas invalida evidência se ignorada |
| 17 | Repo gigante / clone lento | Timeout 120s → fallback shallow + flag `historico_nao_avaliado` (sempre vira gatilho → o revisor decide se importa para aquela skill) |
| 18 | Submodules quebrados | Clone tolera; agente registra no dossiê |
| 19 | Disco enchendo | Janitor: alerta < 15 GB livres; pausa global < 5 GB; poda por idade/label |
| 20 | Mesmo aluno, 2 desafios diferentes ao mesmo tempo | Ok por design: jobs e submissões independentes |
| 21 | Tentativa de 2º run com um ativo | Bloqueado no MVP (1 run ativo por vez); botão desabilitado com explicação |
| 22 | SSE cai | Cliente reconecta e refaz fetch do estado; SSE é notificação, REST é fonte da verdade |
| 23 | Bloco colado incompleto/malformado | Preview aponta o campo faltante por linha; nada entra sem confirmação |
| 24 | Devolutiva quase idêntica à de outro aluno (mesma skill) | Gatilho de similaridade `pg_trgm` (§12) → força revisão |
| 25 | Devolutiva de aprovado longa demais (limite do guia da skill) | Gatilho de tamanho → força revisão |
| 26 | Skill exige execução, dossiê diz que só leu | Gatilho de coerência (§7) → força revisão |
| 27 | 3+ correções com o MESMO gatilho no mesmo run | Banner destacado no dashboard + notificação (indica skill ambígua, não 3 alunos errando igual); humano decide pausar |
| 28 | WSL suspende / máquina dorme no meio | Runbook: desativar suspensão durante runs; jobs interrompidos caem no caso 12 |

## 11. Segurança e privacidade

- **Senha de sudo sai de qualquer prompt.** O runner nasce com as permissões de que precisa; nenhum segredo de infraestrutura circula por texto de LLM.
- **Código de aluno é código de terceiro.** No MVP local, egress do runner fica aberto por necessidade real (instalar dependências, chamar APIs externas dos enunciados — ex.: AwesomeAPI do Client-Server-API). O que endurece na F8: stacks de aluno sem rota para a rede local, socket via proxy (permitir só compose/inspect no prefixo `fc-job-`), possivelmente rootless.
- **Socket do Docker montado no runner = poder total sobre o Docker da máquina.** Aceito conscientemente no MVP local (uma máquina, um usuário); registrado como dívida para o cenário multiusuário/web.
- **Token do Claude** entra por variável de ambiente lida do `.env` do host; nunca commitado; rotação = rodar `claude setup-token` de novo.
- **PII**: nome e e-mail persistem (necessários ao fluxo); celular é descartado no parser. Job dirs (com clones) são apagados pelo janitor após 14 dias; transcripts e dossiês ficam (auditoria) — transcript no filesystem, dossiê no banco.
- Repositórios read-only montados como `:ro` (skill); workspace é descartável por job.

## 12. Observabilidade e operação

- **Logs**: pino estruturado na API/workers com `job_id`/`submissao_id` em todo log; log do entrypoint do runner vai para o job dir.
- **Eventos**: tabela append-only alimenta a timeline do card e a auditoria.
- **SSE**: tópicos `submissao.updated`, `run.updated`, `notificacao.created`, `sistema.pausa`.
- **Gatilhos programáticos** (avaliados pelo backend ao fechar cada correção): tamanho da devolutiva vs. limite do guia; similaridade trigram (`pg_trgm`) contra devolutivas já geradas da mesma skill (limiar inicial 0.6, calibrar na F7); incoerência modo_avaliacao skill × dossiê; execução ausente em skill de execução; `historico_nao_avaliado` (sempre que o fallback shallow ocorreu — mais simples que mapear quais skills avaliam histórico); duração anômala (> p95 da skill). Somam-se aos autorrelatados (campo `duvidas`). Qualquer gatilho força revisão humana (§2.7). Agregação "3+ mesmo gatilho no run" = query + banner + notificação.
- **Métricas no dashboard (MVP)**: contadores por estado, tempo médio de correção (24h), taxa de aprovação por skill, gatilhos por tipo. Análises avançadas (tendências, exportação) ficam para F8 — a matéria-prima já está no banco desde o dia 1.
- **Pausa global**: manual (botão) e automática (limite do plano, credencial, disco crítico). Jobs em andamento terminam; novos não iniciam.
- **Backup**: cron pg-boss diário 03:00 → `pg_dump` para `./backups` (retém 14). Observação: cron do pg-boss roda dentro da API — com a API parada não há janitor nem backup; aceitável no MVP local (runbook cobre).
- **Runbook** (`docs/runbook.md`, escrito na F7): `.wslconfig` recomendado (`processors=6`, `memory=10GB`, `swap=8GB` — hoje está em 2 núcleos, que é o gargalo real), desativar suspensão durante runs, como rodar `claude setup-token`, como recuperar de disco cheio, como restaurar backup.

## 13. Fases de implementação

Estimativas em dias úteis de foco, solo com apoio de IA; ver disclaimer ao final da seção.

### F0 — Fundação e spikes (1–2d)

Objetivo: repo de pé e os três maiores riscos técnicos provados antes de escrever o sistema.

Entregas: monorepo pnpm; `compose.yaml` com Postgres; lint/format; `docs/` com este plano, `INTEGRATION.md` inicial (o que assumimos e as perguntas para a equipe da plataforma: endpoint de pendentes com URL do repo, endpoint de postar status+feedback, formato/existência do webhook, autenticação) e `docs/spikes.md`; ambiente de dev assistido por IA (CLAUDE.md, rules e skills de desenvolvimento — próximos artefatos combinados).

Spikes (aceite = os três verdes, documentados em `docs/spikes.md`):

- **S1 — Claude headless em container com plano Max**: imagem mínima com o CLI; `claude setup-token` no host; `claude -p` no container com `CLAUDE_CODE_OAUTH_TOKEN` lê um SKILL.md montado, segue a instrução e escreve um JSON; transcript capturado via `stream-json --verbose`; definir a flag de permissão para execução não-assistida. É o risco nº 1 do projeto — se travar, tudo para até resolver.
- **S2 — Isolamento de rede**: dois containers sobem processos na 8080 simultaneamente sem conflito; de dentro de cada um, `curl localhost:8080` responde o próprio processo.
- **S3 — Compose sem portas + network externa**: gerar override que remove `ports:`/`container_name:` de um compose real de desafio e aponta a default network para uma externa pré-criada; subir com `-p`; de um segundo container já conectado a essa network, alcançar o serviço por hostname (é exatamente a topologia do §8).

### F1 — Banco e domínio (1–2d)

Entregas: schema Prisma completo (§5) + migrations; extensão `pg_trgm`; seed do `skills_map` via script que lê um CSV (colunas: projeto, fase, skill_slug, modo, base_repo_url, timeout_s) — preencher o CSV é ação do Pierry (§17); tabela `eventos` e `config` com defaults.

Aceite: migrations sobem do zero; seed carrega as ~50 linhas; testes de unidade dos repositórios principais.

### F2 — Runner e execução de jobs (3–4d)

Entregas: imagem do runner (§8); Job Controller (job dir, docker run com mounts/limites/labels, acompanhamento, coleta de artefatos, teardown em camadas); gerador de override noports; conexão do runner à network do job; janitor; recuperação de órfãos no boot; jitter.

Aceite: job fake (sem LLM: script que clona um repo, sobe um compose de exemplo, escreve um dossiê estático) roda fim a fim; 4 jobs fake em paralelo com o mesmo compose de portas fixas, sem colisão; matar o processo da API no meio → após restart + janitor, zero container/network/dir órfão.

### F3 — Correção com Claude (3–5d)

Entregas: `prompt-template.md` do corretor v2 (Apêndice A); montagem da skill no runner; invocação headless com `--model` do run; captura de transcript; validação do dossiê com retry corretivo via `--resume`; veredito `inconclusivo`; injeção de contexto de tentativa anterior.

Aceite: golden repos G1 (aprovado) e G2 (reprovado) corrigidos fim a fim com dossiê válido e devolutiva no formato da skill; G3 (skill estática) corrigido sem subir container; evidência de reprovação em G2 é literal (saída de comando), não paráfrase.

### F4 — Fila, estados e resiliência (2–3d)

Entregas: pg-boss integrado; máquina de estados persistida com transições do §6; limite de 3 execuções por submissão (`retry_n`) + timeout (default 1500s, override por skill); pausa global manual e automática (detecção de limite/credencial nos erros do CLI); cancelamento com kill+teardown; substituição; dedupe por índice parcial; `nao_executada` sem consumo de retry.

Aceite: cenários simulados passam — matar worker no meio, token inválido forjado (pausa + notificação + retomada), submissão duplicada (substitui inclusive durante `corrigindo`), 3 falhas seguidas → `erro` com transcript.

### F5 — API e intake (2–3d)

Entregas: REST (submissões, correções, devolutivas, runs, notificações, config) + SSE; parser de bloco no `packages/shared` com suite de testes de blocos reais (incluindo malformados); endpoint de preview/confirmação; dropdown de skill manual; template de devolutiva de link inválido em `config`.

Aceite: colar 5 blocos reais do admin → 5 submissões corretas; bloco sem repositório → erro apontado na linha do preview; `Celular:` presente no bloco → ausente no banco.

### F6 — Front (4–6d)

Telas: Intake (colar bloco + preview + config do run + botão FC desabilitado com aviso); Dashboard/Fila (contadores por estado, run ativo com progresso, pausar/retomar, banner de gatilho agregado); Revisão (lista + card do §9.3); Prontas para envio (copiar + marcar enviada); Histórico (DataTable com filtros por estado/skill/aluno/período); Notificações (badge + lista).

Aceite: fluxo completo de demo executável só com o mouse: colar blocos → iniciar → acompanhar ao vivo → revisar/editar → enviar → conferir no histórico.

### F7 — Hardening, verificadores e testes (3–5d)

Entregas: gatilhos programáticos do §12 (tamanho, similaridade pg_trgm, coerências, duração anômala) + banner 3+; suite E2E com os golden repos G1–G10 (§14) rodável por script; backup; `docs/runbook.md`; passada final na matriz do §10 confirmando cobertura.

Aceite: suite E2E verde em execução limpa; simulação dos casos 5, 7, 9, 10, 12 e 24–27 do §10 passa.

**Marco: MVP pronto — demo para o chefe.** (Soma F0–F7: ~19–30 dias úteis. Em paralelo com o expediente, algo como 4–6 semanas corridas. Estimativa honesta, não promessa.)

### F8 — Pós-aprovação: multiusuário e web (dimensionar depois)

Auth (avaliar reaproveitar o login da empresa), deploy em host Linux com Docker, socket proxy + egress lateral restrito, chave de API organizacional (ou plano dedicado — decisão do chefe; trocar é variável de ambiente), permissões, métricas avançadas, retenção revisada.

### F9 — Integração FC (depende da equipe da plataforma)

Ativar o receptor de webhook (payloads reais → `webhook_payloads` → escrever o driver contra a realidade); driver `fc_platform` de origem (listar pendentes) e envio (postar status+feedback); reconciliação por polling como fallback do webhook; responder o `INTEGRATION.md`. O botão "Buscar desafios em aberto" passa a funcionar; envio automático real para essa origem.

## 14. Plano de testes

- **Unidade**: parser de bloco (casos reais + malformados), máquina de estados (tabela de transições §6 vira tabela de testes), validador do dossiê, gerador de override, gatilhos programáticos.
- **Integração**: Job Controller com jobs fake (sem LLM) — teardown, órfãos, labels, network connect, limites.
- **E2E (golden repos)**: congelar entregas reais (fork privado ou zip versionado) como fixtures — ação do Pierry (§17):

| Fixture | Cobre |
|---|---|
| G1 | Aprovado limpo (Go, execução) |
| G2 | Reprovado claro com evidência executável |
| G3 | Skill de modo estático (não sobe container) |
| G4 | Link do repositório base do desafio |
| G5 | Repo privado/404 |
| G6 | Projeto+fase sem skill |
| G7 | Compose com `container_name:` e `ports:` fixos |
| G8 | Desafio de processo direto na 8080 — rodado 2× em paralelo |
| G9 | Template com bind mount + `lint --fix` |
| G10 | Repo grande / clone lento (fallback shallow) |

- **Resiliência**: kill do worker, token inválido, reboot simulado, disco (limiar rebaixado artificialmente).
- **Regressão de comportamento do agente**: a suite golden roda de novo a cada mudança de prompt-template, de skill ou de modelo do run — é o detector de "o modelo mudou e a régua mudou junto".

## 15. Riscos e mitigações

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Limite do plano Max estrangula o volume diário | Alta | Médio | Pausa automática + retomada; medir consumo/correção no MVP (o output json do CLI reporta custo/uso) para embasar a conversa de API key com o chefe |
| Headless em container com subscription tiver atrito não previsto | Média | Alto | Spike S1 antes de tudo; fallback: montar `~/.claude` do host |
| Troca/atualização de modelo muda a régua das correções | Média | Alto | Modelo fixado por run + suite golden como regressão antes de adotar modelo novo |
| Skills desatualizadas vs. enunciado da plataforma | Média | Médio | Gatilho agregado (3+) detecta; `skills_map.ativo` desativa na hora; correção da skill é conteúdo, não código |
| Disco (50 clones/dia + node_modules + imagens) | Alta | Baixo | Janitor por idade/label + limiares com pausa |
| Máquina única (WSL) — suspensão, queda, perda | Média | Médio | Recuperação de órfãos + backup diário + runbook; F8 tira da máquina pessoal |
| API da FC diferente do assumido | Alta | Baixo (isolado no driver) | Interfaces de driver + `INTEGRATION.md` + webhook dormante capturando payload real antes de codar |
| Custo surpresa ao migrar para API key | Média | Médio | Métricas de uso por correção coletadas desde o MVP dão o número exato para decidir |
| PII de alunos na máquina local | Baixa | Médio | Mínimo necessário (sem celular), retenção de job dirs 14d, F8 move para infra da empresa |

## 16. Glossário

- **Submissão**: uma entrega de aluno (link + metadados). **Correção**: uma execução do agente sobre uma submissão (pode haver várias, por retry/reprocessamento). **Run**: lote de submissões processadas com uma configuração (modelo, paralelismo, política).
- **attempt_aluno**: tentativa do aluno no desafio (1ª entrega, reenvio pós-reprovação…). **retry_n**: nova execução do sistema sobre a mesma submissão por falha técnica. São contadores independentes.
- **Dossiê**: JSON estruturado que o agente entrega (§7). **Gatilho**: condição que força revisão humana. **Golden repo**: entrega real congelada usada como fixture de teste.
- **Runner**: container efêmero onde uma correção acontece. **Janitor**: rotina que limpa órfãos e monitora disco.

## 17. Ações do Pierry (destravam fases)

1. Preencher o CSV do `skills_map` (~50 linhas: projeto, fase, skill_slug, modo, base_repo_url, timeout_s quando precisar) — destrava F1.
2. Coletar e congelar os golden repos G1–G10 — destrava os aceites de F3/F7.
3. Rodar `claude setup-token` e guardar o token no `.env` — destrava S1.
4. Ajustar `.wslconfig` (`processors=6`, manter `memory=10GB`, `swap=8GB`) e desativar suspensão — destrava testes de paralelismo reais.
5. Validar as decisões tomadas neste plano que ainda são reversíveis de graça: NestJS+Prisma, PrimeVue, nome "Banca".
6. Confirmar com a equipe se as skills atuais declaram explicitamente o modo de avaliação (execução/estática) — se não declararem, padronizar o frontmatter delas antes da F1 facilita o CSV.

## Apêndice A — Prompt do corretor v2 (o que sai, o que fica)

O `corretor-desafios.md` atual mistura julgamento com infraestrutura. O v2 (escrito na F3) separa:

**Sai do prompt — vira código:** numeração/ordem; fila, slots e exit 75; limite de paralelismo; sufixos de slug e colisão de arquivos em /tmp; `ss`/`lsof` e "de quem é a porta"; geração manual do override noports; proibições de `cleanDocker.sh`/prune (o agente nem tem como: teardown é do sistema, limpeza é do janitor); senha de sudo; persistência de dossiê em /tmp; agregação de gatilhos; teste de originalidade entre alunos (vira verificador pg_trgm + revisor).

**Fica — é julgamento:** a skill como única fonte de critérios (inclusive sobre o modo de avaliação, valendo contra a própria delegação); executar de verdade e exercitar o caminho crítico quando a skill manda; investigar ambiente vs. aluno antes de reprovar; delta contra o repo base com os números dos dois lados; nunca alterar o código do aluno para "fazer passar" nem escrever permanente no repo; linter em modo leitura + `git status` + restauração; "container ocioso não é container quebrado" (templates com `tail -f /dev/null`); dossiê honesto — dúvidas explícitas valem mais que conclusão inventada; regras de forma da devolutiva (tamanho, originalidade — agora também verificadas por código).

**Entra de novo:** "você está sozinho nesta máquina; porta ocupada é processo seu; nunca mate processo que você não criou"; o comando canônico de compose (com `-p fc-job-<id>` e o override noports) fornecido pronto no prompt; caminho e schema do `dossie.json` como último ato obrigatório; contexto da tentativa anterior quando existir (verificar nominalmente os pontos reprovados, calibrar tom); proibição de encerrar sem dossiê escrito.

## Apêndice B — Registro da revisão obrigatória do plano

Revisão feita em 06/08/2026, relendo o documento integral e checando: coerência interna (estados × fluxos × edge cases × fases × testes), aderência às decisões já tomadas (cleanDocker aposentado, sem senha de sudo em prompt, egress aberto por necessidade, intake manual como feature definitiva, trava de revisão por dúvida/gatilho) e furos de sequência técnica. Achados, todos corrigidos nesta versão:

1. **Corrida de network entre runner e stack (o achado mais grave).** O texto original conectava o runner à network do compose — que só passa a existir depois que o agente sobe a stack. Corrigido para uma network externa `fc-job-<id>_net`, criada pelo Job Controller antes do runner; o override do compose aponta a default network para ela (§8, §9.2; spike S3 realinhado para provar exatamente essa topologia).
2. **`link_invalido` era terminal, mas tinha uma devolutiva pendente de envio** — contradição de fluxo. Ganhou transição própria `link_invalido → enviada` e saiu da lista de terminais (§6).
3. **`sem_skill` era beco sem saída.** Ganhou recuperação: mapear/escolher a skill e reprocessar (§6).
4. **Ambiguidade do estado `recebida`** vs. preview: definido que confirmar o preview cria a submissão já em `recebida` e a validação dispara automática (§6).
5. **Quem invoca o `claude -p`**: o texto sugeria o Job Controller após o clone; corrigido — o controller escreve `prompt.txt` e o override antes do `docker run`, e o entrypoint do runner clona, faz checkout no SHA e invoca (§9.2, passos renumerados 1–6).
6. **Retry corretivo do dossiê**: explicitado que ocorre via `docker exec` no runner ainda vivo + `claude --resume`, antes do teardown (§7).
7. **Semântica de retry unificada**: 3 execuções totais por submissão (`retry_n` ≤ 3) — linguagem alinhada em §10.9 e F4.
8. **Gatilho de histórico simplificado**: `historico_nao_avaliado` dispara sempre, sem depender de mapear quais skills avaliam Git Flow (§12, §10.17).
9. **Miúdos**: reenvio de aluno não exige mais veredito reprovado na anterior (§9.5); devolutiva vigente em reprocessamento definida (§5); correções órfãs pós-reboot ganham marcação explícita antes de voltar à fila (§10.12).

Verificado e mantido sem alteração: numeração e dependências das fases; referências cruzadas (os casos 5, 7, 9, 10, 12 e 24–27 citados no aceite da F7 existem na matriz do §10); 25 min = 1500 s consistente; teto de paralelismo 2/4 coerente entre §8, F2 e G8; nenhum resquício de `cleanDocker.sh`, senha de sudo ou `docker system prune` como mecanismo do sistema.