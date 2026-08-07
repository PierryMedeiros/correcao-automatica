# F3 — Correção com Claude

> **Status:** ⬜ não iniciada
> **Estimativa:** 3–5 dias úteis (plan §13)
> **Depende de:** F0 (spike S1) · F1 (banco) · F2 (runner e Job Controller)
> **Destrava:** F4 (correção real para a fila orquestrar) · F7 (dossiê e devolutiva que os gatilhos leem)
> **Seções do plano:** §4 (execução LLM) · §7 (dossiê) · §8 (runner, skill, invocação) · §9.2 (pipeline) · §9.5 (nova tentativa) · §10.4, §10.7, §10.8, §10.15–18, §10.26 · §14 (golden repos) · §15 · Apêndice A · Apêndice B (06/08) itens 1 e 6 · Apêndice B v1.3 item 7

## Objetivo

O runner que a F2 sobe deixa de rodar job fake e passa a corrigir de verdade: recebe um `prompt.txt`
montado do template v2, invoca o Claude Code headless — atrás da fronteira `LlmExecutor` — com o
modelo do job e a skill montada RO, e devolve um `dossie.json` validado contra o schema — com um retry corretivo na mesma sessão quando o
dossiê sai errado, antes do teardown. Ao fim da fase existe veredito, evidência literal e
devolutiva-rascunho no formato da skill, persistidos e auditáveis.

## Pré-condições

- [ ] F1 e F2 marcadas ✅ em `docs/fases/README.md`
- [x] Spike S1 verde em `docs/spikes.md` **com a flag de permissão decidida** (§8: `--dangerously-skip-permissions` vs `--allowedTools`) — sem essa decisão não há invocação a escrever. **Decidida: `--allowedTools`**, com `Read,Write,Bash` provados; ampliar a lista para o que as skills reais exigem é decisão desta fase
- [ ] `.env` tem `CLAUDE_CODE_OAUTH_TOKEN` válido (§17.3): repetir a invocação mínima do S1 e obter saída do CLI, não erro de credencial
- [ ] Imagem do runner construída: `docker image inspect $RUNNER_IMAGE` responde
- [ ] Job fake da F2 roda fim a fim (é o esqueleto que esta fase preenche)
- [ ] `packages/shared` existe (F1) e `pnpm test` está verde
- [ ] Skills acessíveis: `test -f "$SKILLS_DIR/<skill_slug>/SKILL.md" && test -f "$SKILLS_DIR/_shared/devolutivas-guide.md"`
- [ ] `skills_map` semeado com `modo_avaliacao` correto para as skills de G1, G2 e G3 (§17.1)
- [ ] Golden repos G1 (aprovado, Go, execução), G2 (reprovado com evidência executável) e G3 (skill estática) congelados e restaurados como bare repos locais clonáveis por `file://` (§14) — **ação humana §17.2; é pré-condição do aceite, não tarefa desta fase**

## Decisões do plano que esta fase materializa

| Decisão | Onde está | Consequência prática nesta fase |
|---|---|---|
| A skill é a única fonte de critérios; o prompt só define conduta | §2.3, Apêndice A | O template v2 não contém critério de correção nenhum; aponta para `/workspace/skill/SKILL.md` |
| A skill é fonte de **critério**, não de mecânica: qual commit avaliar é do sistema | §9.2, §10.4, Apêndice A, Apêndice B v1.5 item 5 | O v2 declara que o repositório já está no commit avaliado e proíbe `fetch`/troca de ref, vencendo a frase "estado atual da branch `main`" que várias skills trazem do fluxo manual |
| Sem descoberta automática de skill em headless — o agente lê pelo tool Read | §8 | Primeira instrução do prompt: ler `SKILL.md` e seguir literalmente, inclusive os arquivos que ela mandar ler |
| O dossiê é o único contrato agente → sistema; o backend nunca interpreta prosa | §2.6, §7 | A devolutiva vai dentro de `devolutiva_rascunho`, não no stdout; ausência de dossiê é falha, não interpretação |
| Retry corretivo via `docker exec` + `claude --resume`, **antes** do teardown, sem consumir `retry_n` | §7, Apêndice B (06/08) item 6 | Ordem obrigatória no fechamento: coleta → valida → (exec/resume) → valida → teardown |
| `stream-json` exige `--verbose` | §4, §8 | A invocação sem `--verbose` falha e o transcript sai vazio |
| Execução LLM é fronteira trocável: CLI headless hoje, SDK/API key depois | §4, CLAUDE.md ("Arquitetura de código") | A invocação nasce atrás de `LlmExecutor`; `ClaudeCliExecutor` é a única implementação aqui, e nenhuma quarta interface é aberta |
| `skills_map` é a fonte da verdade do modo; divergência do dossiê é **gatilho**, não erro | §5, §7, §12, Apêndice B v1.3 item 7 | O validador não reprova por divergência de modo: reporta o fato, que a F7 transforma em gatilho |
| Comando canônico de compose entregue pronto, com a network externa já criada | §8, §9.2, Apêndice B (06/08) item 1 | O prompt não pede ao agente que invente `-p` nem gere override; ele recebe a linha pronta |
| O comando canônico usa o caminho **absoluto** do job dir, não `/workspace` | §8, Apêndice B v1.6 item 1 (spike S3) | F3.3 monta a linha com o caminho espelhado; é o que impede um `./algo` no compose do aluno de virar diretório vazio criado pelo daemon do host |
| Contexto de tentativa anterior: critérios não mudam, verificação nominal + calibragem de tom | §9.5, Apêndice A | Bloco opcional do prompt, montado só quando `anterior_id` existe |
| `historico_nao_avaliado` quando o clone caiu no fallback shallow | §7, §9.2, §10.17 | O entrypoint (F2) sinaliza; o prompt obriga o agente a propagar o campo no dossiê |
| Tudo que virou código sai do prompt (slots, exit 75, `ss`/`lsof`, override manual, sudo) | Apêndice A | A remoção é verificável por `grep` contra `docs/legado/corretor-desafios.md` |
| `$SKILLS_DIR/_shared` montado RO em `/workspace/_shared`, com falha alta se o guia não existir | §8, Apêndice B v1.5 item 1 | O `../_shared/devolutivas-guide.md` que as 49 skills citam resolve dentro do runner sem editar skill nenhuma |
| A proibição de limpeza global de Docker **fica** no prompt: o socket montado dá ao agente o poder | Apêndice A, Apêndice B v1.5 item 4 | Uma linha explícita no v2 — o guard de `scripts/hooks/` intercepta o shell do desenvolvedor, não o processo dentro do runner |

## Decisões a tomar nesta fase

| # | Pergunta em aberto | Opções | Recomendação |
|---|---|---|---|
| ~~D1~~ | Como o `_shared/` das skills chega ao runner | — | **Resolvida no plano (v1.5, §8)**: `$SKILLS_DIR/_shared` montado RO em `/workspace/_shared`. Ver a linha correspondente em "Decisões do plano que esta fase materializa". O número fica reservado — o arquivo o referencia |
| ~~D2~~ | Se a proibição de limpeza global de Docker fica no prompt | — | **Resolvida no plano (v1.5, Apêndice A)**: fica, e a justificativa antiga ("o agente nem tem como") estava errada. O número fica reservado — o arquivo o referencia |
| D3 | De onde vem o `--model` na F3, se o run só é orquestrado na F4 | (a) campo `modelo` no payload de entrada do Job Controller, preenchido pelo harness; (b) ler `runs.modelo` já agora | (a) — a F4 passa a preencher o mesmo campo a partir de `runs.modelo` sem mudar assinatura |
| D4 | O que a F3 persiste no banco | (a) só artefatos no job dir; (b) linha em `correcoes` + `devolutivas.texto_agente` | (b) — as tabelas existem desde a F1, o aceite pede veredito e devolutiva, e persistir agora evita reescrever o fechamento na F4. Transições de estado, gatilhos e política de revisão continuam fora |
| D5 | Onde mora o validador do dossiê e o que acontece com o que a F2 usou no job fake | (a) `packages/shared` (schema + validador puro), API só orquestra; (b) validador dentro da API | (a) — o §7 já nomeia `packages/shared/dossie.schema.json`, e F5/F6 vão querer os tipos. O que a F2 usou como stub é substituído nesta fase |
| D6 | Como o retry corretivo obtém o `session_id` para o `--resume` | (a) parsear o evento inicial do `transcript.jsonl`; (b) fixar `--session-id <uuid>` gerado pelo sistema na invocação, se o CLI aceitar | O S1 provou **(a)** ponta a ponta no CLI 2.1.224: o `session_id` está na primeira linha (`type: "system", subtype: "init"`) e o `--resume` com ele reescreveu a saída na mesma sessão. **(b) não foi testado** — se a fase quiser o caminho determinístico, testar `--session-id` é trabalho desta fase, com (a) como fallback já validado |
| D7 | Captura de custo/uso por correção, que o §15 pede medir e o §5 não tem onde guardar | (a) não persistir agora — o dado fica no transcript; (b) criar coluna em `correcoes` (muda o §5) | (a) — o transcript é auditável e a agregação é F8; coluna nova exigiria mudar o §5 antes |
| ~~D8~~ | Se "estado atual da branch main" das skills vence o SHA pinado | — | **Resolvida no plano (v1.5, Apêndice A)**: não vence. O prompt v2 declara a precedência do SHA pinado e proíbe `fetch`/troca de ref; a skill é fonte de critério, não de infraestrutura. As 49 skills não são editadas. O número fica reservado — o arquivo o referencia |

## Etapas

### F3.1 — Contrato do dossiê em `packages/shared`

**Entrega:** o JSON Schema do dossiê e um validador puro, com a semântica do §7 além do schema.

**Arquivos:** `packages/shared/dossie.schema.json`, validador e tipos em `packages/shared/src/` (seguindo a estrutura que a F1 estabeleceu), `packages/shared/src/**/*.test.ts`

**Tarefas**

- [ ] Escrever `dossie.schema.json` com todos os campos do §7, `schema_version: 1` e `additionalProperties: false`
- [ ] Marcar `motivo_inconclusivo` como obrigatório quando `veredito = inconclusivo`
- [ ] Implementar as validações semânticas do §7: `reprovado` exige ≥1 critério com `resultado: falha` e `evidencia` não-vazia
- [ ] Expor as verificações de coerência (`modo_avaliacao` do dossiê × `skills_map`; `execucao.executou = false` em skill de modo `execucao`) como **fatos sinalizados**, não como falha de validação — quem as transforma em gatilho é a F7
- [ ] Derivar os tipos TS do schema (ou validá-los contra ele) para que `api` e `web` não redeclarem o dossiê
- [ ] Fazer o validador devolver mensagem de erro legível o suficiente para ser colada no prompt do retry corretivo (F3.5)

**Testes:** suite do validador — mínimo válido, `reprovado` sem critério `falha`, evidência vazia, `inconclusivo` sem motivo, `schema_version` desconhecida, divergência de modo (válido + fato sinalizado), `historico_nao_avaliado` presente.

**Pronto quando:** `pnpm test` verde com a suite do validador e um dossiê de exemplo do §7 validando sem ajuste.

### F3.2 — `prompt-template.md` v2

**Entrega:** o prompt do corretor refatorado conforme o Apêndice A — só julgamento e conduta, zero infraestrutura.

**Arquivos:** `runner/prompt-template.md`

**Tarefas**

- [ ] Escrever o v2 a partir de `docs/legado/corretor-desafios.md` portando **item a item** as três listas do Apêndice A: remover cada item de "sai do prompt — vira código", preservar cada item de "fica — é julgamento", acrescentar cada item de "entra de novo". O Apêndice A é a lista; este arquivo não a copia
- [ ] Fechar a portagem com uma passada de conferência lista × template, item por item, registrando no Registro de execução qualquer item do Apêndice A que tenha sido interpretado de forma não óbvia
- [ ] Instruir o teardown de camada 1 do agente: `docker compose -p fc-job-<id> down -v` ao final (§8)
- [ ] Instruir a propagação de `historico_nao_avaliado`, `container_name_fixo_no_compose`, `arquivos_auxiliares` e submodules quebrados para os campos correspondentes do dossiê
- [ ] Declarar que o repositório já está no commit avaliado, proibindo `fetch`/troca de ref, com precedência explícita sobre qualquer menção da skill a "estado atual da branch `main`" (Apêndice A, §9.2, §10.4) — e que o veredito `inconclusivo` com `motivo_inconclusivo` é a saída correta quando o repositório não corresponde à skill (§10.8)
- [ ] Portar a proibição de limpeza global de Docker do Apêndice A: nada de `prune` de qualquer tipo, `rmi`, `rm`/`kill` de container, network ou volume fora do próprio job
- [ ] Marcar os placeholders com uma sintaxe única e greppável (ex.: `{{aluno_nome}}`), para que o teste do montador consiga provar que nenhum sobrou

**Testes:** nenhum unitário do conteúdo — o texto é conteúdo, não código. A verificação é o `grep` do aceite A6 e o comportamento observado em G1–G3.

**Pronto quando:** o `grep` da lista "sai" não encontra ocorrência e o template cabe em uma leitura sem repetir critério de skill nenhuma.

### F3.3 — Montagem do `prompt.txt`

**Entrega:** o Job Controller escreve, no job dir, um `prompt.txt` completo e sem segredo, apontando para a skill e o guia que a F2.4 monta.

**Arquivos:** módulo de montagem do prompt onde a F2 colocou o Job Controller

**Tarefas**

- [ ] Resolver `skill_slug` → `$SKILLS_DIR/<skill_slug>` e **falhar antes do `docker run`** se `SKILL.md` não existir (falha alta e barata, no espírito do seed da F1)
- [ ] Conferir que o `docker create` da F2.4 já monta `$SKILLS_DIR/_shared` em `/workspace/_shared:ro` e aborta se o guia não existir (§8); se a F2 tiver sido implementada sem isso, o conserto é lá — esta fase só depende do mount
- [ ] Preencher o template com os dados do job: aluno, projeto+fase, skill, `commit_sha`, caminho do clone (`/workspace/repo`), caminho do dossiê (`/workspace/dossie.json`)
- [ ] Montar o comando canônico de compose com `-p fc-job-<id>`, o compose do aluno e o override noports gerado pela F2, nos **caminhos absolutos do job dir** — não em `/workspace` (plan §8, Apêndice B v1.6 item 1). O S3 provou em bancada que o compose resolve caminho relativo do aluno contra o diretório do arquivo e entrega o resultado ao daemon do host: `-f /workspace/...` faz o `./algo` do aluno virar um diretório vazio criado pelo daemon, sem erro nenhum. O job dir é montado nos dois caminhos justamente para o comando canônico poder usar o absoluto
- [ ] Garantir que nenhum valor de `.env` (token, `DATABASE_URL`) seja interpolado no prompt — regra dura 5
- [ ] Falhar a montagem se sobrar qualquer placeholder não substituído

**Testes:** montador — todo placeholder resolvido; comando canônico contém `-p fc-job-<id>` e o override; nenhum segredo no texto final; skill inexistente aborta antes do `docker run`.

**Pronto quando:** um job real gera `<job_dir>/prompt.txt` legível, com o comando canônico correto, e `grep -i 'oauth\|token' <job_dir>/prompt.txt` não retorna nada.

### F3.4 — `LlmExecutor`, invocação headless e captura do transcript

**Entrega:** a fronteira `LlmExecutor` com sua primeira implementação, `ClaudeCliExecutor`; por trás dela, o entrypoint do runner invoca o Claude com o modelo do job e grava o transcript completo.

**Arquivos:** `apps/api/src/llm/llm-executor.ts`, `apps/api/src/llm/claude-cli-executor.ts`, `apps/api/src/llm/claude-cli-executor.test.ts`, `runner/entrypoint.sh`, extrator de metadados do transcript em `packages/shared/src/`

**Tarefas**

- [ ] Declarar `LlmExecutor` com duas operações: `corrigir(job)` — modelo, job dir e `prompt.txt` — e `retomar(session_id, mensagem)`, ambas devolvendo `exit_code`, `session_id` e caminho do transcript. É uma das três fronteiras de inversão autorizadas pelo CLAUDE.md ("Arquitetura de código": `OrigemDriver`, `EnvioDriver`, `LlmExecutor`); nenhuma quarta interface entra junto
- [ ] Implementar `ClaudeCliExecutor`: `corrigir` monta a linha do CLI no seam `FC_PAYLOAD_CMD` do entrypoint (F2, D4) e lê o desfecho no job dir; `retomar` reinvoca por `docker exec` no runner ainda vivo. Todo conhecimento de flag do CLI mora aqui — Job Controller e fechamento falam só com a interface
- [ ] Invocar conforme §8: `claude -p "$(cat prompt.txt)" --model <modelo> --output-format stream-json --verbose > /workspace/transcript.jsonl`, com a flag de permissão definida no S1 (`--allowedTools`)
- [ ] Definir a allowlist de tools que as skills reais exigem, rodando G1–G3 e olhando o resultado — `Read,Write,Bash` é só o que o S1 provou com carga sintética; correção de verdade tende a precisar de `Glob`, `Grep` e `Edit`
- [ ] O extrator do transcript devolve também `permission_denials`, e array não-vazio é tratado como sinal, não como linha de log. Em `-p` não há quem responda ao pedido de permissão: a tool é **negada e a execução continua**, terminando com exit 0 — sem isso, uma skill que precise de uma tool fora da lista produz correção pior sem nenhum erro no caminho (spike S1)
- [ ] Passar o modelo pelo caminho decidido em D3 (variável de ambiente do container, junto de `FC_JOB_ID`)
- [ ] Persistir o exit code do `claude` em arquivo no job dir, para o Job Controller ler mesmo se o container morrer
- [ ] Aplicar D6: fixar ou extrair o `session_id` e deixá-lo disponível ao Job Controller antes do fechamento
- [ ] Não deixar o entrypoint mascarar erro do CLI: o exit code do `claude` vai para o marcador `/workspace/resultado.json` que a F2.2 escreve — o container **não** encerra ao fim da carga (F2 D10), senão o retry corretivo do §7 não tem onde acontecer
- [ ] Registrar log do entrypoint no job dir (§12)

**Testes:** contrato do `ClaudeCliExecutor` — a linha montada carrega `--model`, `--output-format stream-json` e `--verbose`, e `retomar` emite exatamente um `docker exec` com `claude --resume <session_id>`; extrator de `session_id` e `exit_code` a partir de um `transcript.jsonl` fixture capturado no S1 (formato real, não inventado); transcript truncado/vazio não derruba o extrator — vira erro tratado.

**Pronto quando:** uma correção real produz `transcript.jsonl` não-vazio, `exit_code` legível e `session_id` recuperável, e nenhum módulo fora de `apps/api/src/llm/` monta comando do CLI.

### F3.5 — Fechamento: validação, retry corretivo e persistência

**Entrega:** o Job Controller fecha a correção validando o dossiê, com um retry corretivo na mesma sessão antes do teardown, e persiste o resultado.

**Arquivos:** fechamento do Job Controller (onde a F2 o colocou)

**Tarefas**

- [ ] Ler `<job_dir>/dossie.json` e validar com o validador da F3.1; ausência do arquivo é o mesmo caso de JSON inválido (§10.7)
- [ ] Em caso de inválido, reinvocar **no runner ainda vivo** pelo `retomar` do `LlmExecutor` (F3.4) — `docker exec` + `claude --resume <session_id>` — com a mensagem de erro do validador, exatamente 1 vez (§7, Apêndice B (06/08) item 6)
- [ ] Garantir por código que o teardown só ocorre depois da segunda validação — inverter essa ordem torna o retry impossível
- [ ] Não incrementar `retry_n` no retry corretivo; se a segunda validação falhar, marcar a correção como `falhou` com `erro_resumo` do validador (o consumo de retry do job é F4)
- [ ] Aplicar D4: persistir `correcoes` (veredito, dossiê em jsonb, modelo, duração, `started_at`/`finished_at`, `transcript_path`, `exit_code`) e `devolutivas.texto_agente` a partir de `devolutiva_rascunho`, com `texto_final` começando igual — `texto_agente` é imutável (regra dura 7)
- [ ] Preservar o job dir da correção persistida, inclusive quando `falhou` (§11) — apagá-lo é o bug
- [ ] Logar o ciclo com `job_id`/`submissao_id` (§12)

**Testes:** fechamento com o `LlmExecutor` substituído por dublê e Docker mockado na fronteira — dossiê inválido dispara exatamente 1 `--resume` e só então o teardown; dossiê válido não dispara `--resume`; segunda falha marca `falhou` sem tocar em `retry_n`; `texto_agente` não é reescrito quando a correção é reprocessada.

**Pronto quando:** os dois caminhos (válido de primeira; inválido → corrigido no `--resume`) rodam de ponta a ponta com evidência em log.

### F3.6 — Contexto de tentativa anterior

**Entrega:** quando a submissão tem `anterior_id`, o prompt carrega a devolutiva anterior e os pontos reprovados.

**Arquivos:** montador do prompt (F3.3), bloco opcional em `runner/prompt-template.md`

**Tarefas**

- [ ] Buscar a devolutiva vigente da submissão anterior e os critérios com `resultado: falha` do dossiê dela
- [ ] Montar o bloco só quando `anterior_id` existe; sem ele, o prompt não menciona tentativa anterior
- [ ] Escrever a instrução do §9.5: os critérios não mudam (a skill segue sendo a régua), mas cada ponto apontado antes é verificado nominalmente, e o tom/nível de dica é calibrado pela história do aluno
- [ ] Usar `texto_final` da devolutiva anterior quando existir (é o que o aluno recebeu), não `texto_agente`

**Testes:** montador com e sem `anterior_id`; com `anterior_id`, o bloco contém o texto que o aluno recebeu e os pontos reprovados.

**Pronto quando:** dois `prompt.txt` gerados a partir da mesma submissão, com e sem anterior, diferem exatamente por esse bloco.

### F3.7 — Golden repos G1–G3 e correção fim a fim

**Entrega:** um comando corrige um golden repo de verdade e produz dossiê válido, veredito e devolutiva.

**Arquivos:** `scripts/corrige-uma.ts` (evolução do harness de job fake da F2)

**Tarefas**

- [ ] Aceitar repo (`file://`), skill, modelo e — opcionalmente — submissão anterior, e disparar o pipeline completo da F2+F3
- [ ] Rodar G1, G2 e G3 e guardar `dossie.json`, `transcript.jsonl` e a linha de `correcoes` como evidência dos aceites
- [ ] Conferir à mão que a evidência de reprovação de G2 é saída literal de comando, não paráfrase (§7: evidência obrigatória e não-vazia quando `resultado=falha`)
- [ ] Conferir que G3 não subiu container nenhum além do runner
- [ ] Registrar no Registro de execução o caminho dos bare repos usados (o script de restauração dos zips é entrega da F7)

**Testes:** nenhum automatizado aqui — G1–G3 custam invocação real do modelo; a suite E2E rodável por script é F7.

**Pronto quando:** os aceites A1–A3 têm evidência guardada.

## Edge cases do §10 cobertos aqui

| # | Caso | Como esta fase trata | Onde é verificado |
|---|---|---|---|
| 4 | Aluno dá push após o intake | Prompt declara o SHA avaliado e proíbe `fetch`/troca de ref, vencendo a frase "branch main" das skills (Apêndice A) | Leitura do template + A6 |
| 7 | Dossiê ausente / JSON inválido | Retry corretivo único via `--resume` antes do teardown (F3.5) | A4, A5 |
| 8 | Veredito `inconclusivo` | Enum no schema + `motivo_inconclusivo` obrigatório + instrução de quando usá-lo | Suite do validador (F3.1) |
| 15 | `container_name:` fixo no compose | Prompt obriga registrar em `container_name_fixo_no_compose` | Dossiê de G1/G2 |
| 16 | Bind mount + `lint --fix` reescreve arquivos do aluno | Regra de conduta no v2: linter em modo leitura, `git status --short`, restaurar e declarar | Leitura do template (G9 é F7) |
| 17 | Clone lento → fallback shallow | Prompt obriga propagar `historico_nao_avaliado`; o gatilho é F7 | Suite do validador (G10 é F7) |
| 18 | Submodules quebrados | Prompt obriga registrar em `execucao.observacoes` | Leitura do template |
| 26 | Skill exige execução, dossiê diz que só leu | O dossiê carrega `modo_avaliacao` e `execucao.executou`; o validador sinaliza a incoerência sem invalidar | Suite do validador; virar gatilho é F7 |

## Critérios de aceite

| # | Critério | Como provar | Evidência esperada |
|---|---|---|---|
| A1 | G1 corrigido fim a fim, aprovado | `pnpm tsx scripts/corrige-uma.ts --repo file://<g1.git> --skill <slug> --model <modelo>` | `dossie.json` válido contra o schema, `veredito: aprovado`, `devolutiva_rascunho` no formato da skill, linha em `correcoes` |
| A2 | G2 reprovado com evidência **literal** | mesmo comando com G2 | ≥1 critério `falha` cuja `evidencia` é saída de comando (conferida contra o `transcript.jsonl`), não paráfrase |
| A3 | G3 (skill estática) corrigido sem subir container | mesmo comando com G3 | `execucao.executou: false`, `comandos_docker: []`; `docker ps -a --filter label=fc.job=<id>` mostra só o runner |
| A4 | Retry corretivo funciona e não consome retry | forçar dossiê inválido (arquivo truncado antes do fechamento) | Log com `docker exec` + `claude --resume`, 2ª validação verde, `retry_n` inalterado, teardown só depois |
| A5 | Dossiê inválido nas duas tentativas → correção `falhou` com rastro | segundo dossiê também inválido | `correcoes.status = falhou`, `erro_resumo` com o erro do validador, job dir preservado (§11) |
| A6 | Template v2 sem nada da lista "sai" do Apêndice A | `grep -Eni 'cleanDocker\|system prune\|fc-docker-run\|exit 75\|lsof\|ss -ltnp\|sudo' runner/prompt-template.md` | Zero ocorrências de `cleanDocker`, `exit 75`, `lsof`, `ss -ltnp` e `sudo`; `prune` aparece **somente** na linha de proibição que o Apêndice A manda incluir |
| A7 | Nenhum segredo no prompt | `grep -i 'oauth\|token' <job_dir>/prompt.txt` | Zero ocorrências |
| A8 | Contexto de tentativa anterior entra só quando existe | gerar `prompt.txt` com e sem `anterior_id` | Diff limitado ao bloco de tentativa anterior |
| A9 | `pnpm lint` e `pnpm test` verdes com as suites do validador, do montador e do `ClaudeCliExecutor` | `pnpm lint && pnpm test` | Saída verde |

- [ ] A1
- [ ] A2
- [ ] A3
- [ ] A4
- [ ] A5
- [ ] A6
- [ ] A7
- [ ] A8
- [ ] A9

## Testes que nascem nesta fase

- **Validador do dossiê** (`packages/shared`): dossiê mínimo válido; `reprovado` sem critério `falha`; `falha` com evidência vazia; `inconclusivo` sem `motivo_inconclusivo`; `schema_version` desconhecida; divergência de modo (válido, com o fato sinalizado); `historico_nao_avaliado` presente. Unidade pura, sem mock.
- **Montador do `prompt.txt`**: nenhum placeholder remanescente; comando canônico com `-p fc-job-<id>` e o override; ausência de segredo; skill inexistente aborta antes do `docker run`; bloco de tentativa anterior presente/ausente conforme `anterior_id`.
- **Extrator do transcript**: `session_id` e `exit_code` a partir de fixture real do S1; transcript vazio/truncado vira erro tratado.
- **`ClaudeCliExecutor`** (`apps/api/src/llm/`): a linha do CLI sai com `--model`, `--output-format stream-json` e `--verbose`; `retomar` emite exatamente um `docker exec` com `claude --resume <session_id>`. Teste do contrato da fronteira `LlmExecutor` (CLAUDE.md), não da implementação por dentro.
- **Fechamento da correção** (`LlmExecutor` por dublê, Docker mockado só na fronteira): inválido → exatamente 1 `--resume` → teardown; válido → nenhum `--resume`; segunda falha → `falhou` sem tocar em `retry_n`; `texto_agente` imutável em reprocessamento.

Não escrever: teste que só reafirma o mock do CLI, snapshot integral do `prompt.txt` (quebra a cada
ajuste de redação sem mudar comportamento), teste de campo trivial do schema.

## Riscos e armadilhas

- **Flag de permissão indefinida.** Se o S1 não fechou qual é (§8), a F3 para. Não escolher `--dangerously-skip-permissions` por conta própria: é decisão do spike, e a fronteira de segurança é o container.
- **`stream-json` sem `--verbose` (§4)** falha ou devolve transcript vazio — e o sintoma aparece só no fechamento, quando não há `session_id` nem dossiê.
- **Inverter a ordem do fechamento.** A F2 entrega teardown garantido; é natural que ele viva num `finally`. Se rodar antes da validação, o `--resume` do §7 fica impossível e o sintoma é "retry corretivo nunca funciona", sem erro visível.
- **`_shared/devolutivas-guide.md` ausente no runner (§8).** O agente segue sem o guia e a devolutiva sai fora do padrão sem nenhum erro — falha silenciosa que só aparece na revisão humana. Por isso a montagem falha alto se o arquivo não existir.
- **Prompt inflado.** O legado tem 265 linhas e metade vira código. Template grande gasta contexto, dilui a skill e reintroduz critério duplicado — exatamente o que o §2.3 proíbe.
- **Mudança de template ou de modelo muda a régua** (§15). Toda alteração no v2 obriga a rodar G1–G3 de novo; é o detector de regressão de comportamento do agente (§14).
- **Custo real por rodada.** Cada execução de golden repo consome o plano Max, e a pausa automática por limite (§10.10) só existe na F4 — aqui o limite estourado aparece como falha crua do CLI. Rodar G1–G3 em série, não em lote.
- **Golden repo que depende de API externa** (ex.: AwesomeAPI no Client-Server-API) pode falhar por rede: é falha de ambiente, não do aluno, e o prompt tem que ser explícito sobre investigar ambiente antes de reprovar.
- **Node fora do PATH em shell não-interativo** (STATUS.md): vale para qualquer script chamado pelo Job Controller e para o entrypoint do runner. Caminho absoluto ou `corepack` no PATH do serviço.
- **Agente encerrando o turno sem dossiê** — falha real observada no fluxo legado. A instrução tem que ser explícita no v2 e o sistema trata a ausência como dossiê inválido, caindo no retry corretivo.

## O que NÃO entra nesta fase

- Gatilhos programáticos (tamanho, similaridade `pg_trgm`, coerência de modo, duração anômala) e banner 3+ → F7
- Máquina de estados persistida, `retry_n` ≤ 3, timeout do job, pausa global, `nao_executada`, cancelamento e substituição → F4
- `FakeLlmExecutor` (test double reutilizável sobre a interface entregue aqui) e a injeção dele nos workers da fila → F4
- Política de revisão e transições `corrigindo → aguardando_revisao | pronta_envio` → F4
- REST, SSE, parser de bloco e qualquer tela → F5 / F6
- G4–G10 e suite E2E rodável por script (incluindo o restaurador de zips em bare repos) → F7
- Imagem do runner, job dir, network do job, override noports, teardown em camadas, janitor → F2 (já entregue)
- Métricas agregadas de custo/uso por correção (D7) → F8

## Impacto em fases seguintes

A preencher no encerramento da fase.

| O que mudou aqui | Fase afetada | O que foi atualizado lá |
|---|---|---|

## Registro de execução

A preencher durante a fase.

- **Iniciada em:** AAAA-MM-DD
- **Concluída em:** AAAA-MM-DD
- **Decisões tomadas:** (D3–D7, com link para STATUS.md; D1, D2 e D8 já subiram ao plano em v1.5 — §8 e Apêndice A)
- **Divergências do plano:** (o que divergiu, por quê, e onde foi registrado)
- **Evidência dos aceites:** (saída de comando, resultado de teste, caminho dos job dirs de G1–G3)
