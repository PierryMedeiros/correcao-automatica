# F7 — Hardening, verificadores e testes

> **Status:** ⬜ não iniciada
> **Estimativa:** 3–5 dias úteis (plan §13)
> **Depende de:** F3 (correção com dossiê) · F4 (resiliência) · F5 (API) · F6 (telas)
> **Destrava:** F8 (o endurecimento pós-aprovação parte daqui)
> **Seções do plano:** §12 (gatilhos, backup, runbook) · §14 (plano de testes, G1–G10) · §10 (matriz inteira) · §7 (coerências) · §2.7 · §11 (retenção) · Apêndice B v1.3 itens 4 e 5

## Objetivo

Ao fim da F7 o sistema para de depender do olho do revisor para perceber devolutiva fora do padrão: seis gatilhos programáticos são avaliados ao fechar cada correção, forçam revisão humana independente da política do run e alimentam o alerta agregado do §10.27. Junto disso, o comportamento do sistema inteiro passa a ser reprodutível por script — dez fixtures golden locais, sem depender de repositório remoto nem de repo de aluno que pode sumir — e a operação ganha backup diário e runbook executado, não imaginado.

## Pré-condições

- [ ] F6 marcada ✅ em `docs/fases/README.md` (e com ela F1–F5) — sem UI não há banner nem card de revisão para provar o aceite
- [ ] D1 resolvida e `GOLDEN_DIR` definido no `.env` (registrá-lo no `.env.example` é tarefa da F7.8, não pré-condição); então, com os golden repos congelados (§17.2), `ls "$GOLDEN_DIR"/*.zip` lista os zips das fixtures que precisam de zip — G1, G2, G3, G7, G8, G9, G10 (G4, G5 e G6 são fixtures de dados e não têm zip)
- [ ] `.env` com `CLAUDE_CODE_OAUTH_TOKEN` válido (§17.3) — a suite roda o agente de verdade em G1–G3
- [ ] `.wslconfig` aplicado e suspensão desativada (§17.4): `nproc` devolve ≥ 6 dentro do WSL — G8 roda duas correções em paralelo
- [ ] `pg_trgm` habilitada (F1): `SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';` devolve 1 linha
- [ ] `config` já tem os limiares de tamanho semeados na F1 (§13 F1): `SELECT chave, valor FROM config WHERE chave LIKE '%tamanho%';`
- [ ] O fechamento da correção (§9.2 passo 6) já persiste `correcoes.gatilhos` e aplica a política de revisão (F4). Se esse ponto de entrada não existir, F7.1 o cria antes de qualquer regra
- [ ] ≥ 20 GB livres (`df -h`) — a suite clona 10 repos e sobe stacks; abaixo de 15 GB o próprio janitor alerta (§10.19)

## Decisões do plano que esta fase materializa

| Decisão | Onde está | Consequência prática nesta fase |
|---|---|---|
| Qualquer gatilho força revisão humana, mesmo com política `nenhuma` | §2.7, §6 | O avaliador roda **antes** da decisão de política; lista não-vazia ⇒ `aguardando_revisao` |
| Limiares são globais em `config`, não por skill | §10.25, Apêndice B v1.3 item 4 | Nenhuma coluna nova em `skills_map`; leitura em runtime, calibração sem deploy |
| Duração anômala tem regra dupla | §12, Apêndice B v1.3 item 5 | n ≥ 10 correções concluídas da skill ⇒ p95; abaixo disso ⇒ 80% do timeout efetivo |
| `historico_nao_avaliado` dispara sempre | §12, §10.17, Apêndice B (06/08) item 8 | Leitura direta do campo do dossiê, sem mapear quais skills avaliam Git Flow |
| Coerência dossiê × `skills_map` é gatilho, não invalidação | §7, §5 | O CSV digitado à mão custa uma revisão, nunca uma devolutiva errada enviada |
| Fixtures golden são locais: zip → bare → `file://` | §14, Apêndice B v1.1 | Sem fork privado: o clone do runner é sem autenticação e o repo do aluno pode ser deletado |
| As métricas do dashboard no MVP são quatro | §12 | A quarta (`gatilhos por tipo`) já é entregue pelo endpoint de métricas da F5 e devolve lista vazia até aqui; ao persistir `correcoes.gatilhos` (F7.1) ela passa a ter dado, sem tocar em F5 nem em F6 |
| Agregação "3+ mesmo gatilho no run" é rota própria | §10.27, §12 | Endpoint de agregação nasce aqui (F7.7) e é o que o banner da F6 consome; não se confunde com a métrica `gatilhos por tipo` do dashboard |
| Backup é cron do pg-boss dentro da API | §12 | Nenhum daemon novo; API parada = sem backup, e isso é assunto do runbook |
| Limpeza só por label `fc.job=<id>` / prefixo `fc-job-` | Regra dura 1, §12 | A suite deixa resíduo: teardown por label ao fim de cada cenário, jamais prune |
| `devolutivas.texto_agente` é imutável | Regra dura 7 | Os gatilhos **leem** o rascunho do agente; nenhuma etapa aqui reescreve devolutiva |
| Teste é de comportamento e contrato | CLAUDE.md, skill `implementar-fase` | A suite golden afere veredito, estado e evidência — nunca igualdade de texto |

## Decisões a tomar nesta fase

| # | Pergunta em aberto | Opções | Recomendação |
|---|---|---|---|
| D1 | Onde moram os zips das fixtures golden? | `tests/fixtures/golden/` versionado vs. `$GOLDEN_DIR` externo no `.env` | `$GOLDEN_DIR` externo, espelhando a decisão do `SKILLS_DIR` (Apêndice B v1.3 item 6): é código de terceiro (§11), pesa, e zip é binário — o guard de segredo é cego a binário (STATUS.md), então `.env` de aluno dentro de um zip entraria no repo sem alarme |
| D2 | Como o runner enxerga o bare local para clonar `file://`? | Mount `:ro` de `$GOLDEN_DIR` com o mesmo caminho dentro e fora vs. copiar o bare para o job dir e reescrever a `repo_url` | Mount `:ro` condicional quando `repo_url` começa com `file://` — o caminho resolve idêntico dentro do container e nada da produção muda; copiar duplica gigabytes no G10 e falseia a `repo_url` gravada na submissão |
| D3 | Como forçar o fallback shallow do G10, se o clone local é rápido? | Rebaixar artificialmente o timeout de clone no cenário vs. fixture realmente enorme | Rebaixar o timeout — é a mesma técnica que o §14 já usa para o cenário de disco, e mantém a fixture pequena |
| D4 | A suite E2E roda sempre com LLM? | Tudo com LLM vs. cada fixture marcada `llm`/`fake` com `--only=fake` | Marcar cada cenário: `--only=fake` dá o ciclo rápido e determinístico (via job fake da F2); a suite completa é obrigatória antes de trocar prompt, skill ou modelo (§14) |
| D5 | Qual limiar de tamanho vale para `aprovado_com_observacao` e `inconclusivo`? | Tratar como aprovado · tratar como reprovado · terceiro limiar em `config` | `aprovado_com_observacao` usa o limiar de reprovado (carrega observação, precisa de espaço); `inconclusivo` é avaliado e registrado normalmente, mas já vai para revisão pelo §6 — não inventar limiar novo |
| D6 | O que conta como "frase" na contagem do §10.25? | Terminador `.!?` cru · terminador fora de bloco de código, item de lista contando como frase · tokenizador de terceiro | A regra do meio, implementada em `packages/shared` e travada por teste: devolutiva tem bullets e trechos de código, e terminador cru conta o ponto de `v1.2` como frase |
| D7 | Contra quem a similaridade compara? | Todas as devolutivas da mesma skill vs. excluindo a linhagem do próprio aluno | Excluir a própria devolutiva e as do mesmo `aluno_email` + projeto + fase: o reenvio do §9.5 é legitimamente parecido com a devolutiva anterior e dispararia sozinho, virando ruído garantido |
| D8 | Onde ficam os limiares de similaridade, duração e agregação? | `config`, como os de tamanho, vs. constante em código | `config`, com `gatilho_duracao_min_amostras`, `gatilho_duracao_fracao_timeout` e `gatilho_agregacao_min_ocorrencias` já semeadas na F1.7 (idempotente); banco criado antes disso precisa de migration de dados — calibrar tem que ser mudar linha, não recompilar |
| D9 | O banner 3+ é UI da F6 e a agregação é backend da F7 — o que a F6 consumiu enquanto isso? | F6 deixou mock · F6 deixou o componente ligado a um endpoint vazio | Resolvida: a F6 entregou o componente já ligado ao endpoint de agregação desta fase, oculto enquanto a rota devolvia vazio. Aqui a rota passa a responder e as provas do banner são aceite desta fase (A5). Se ainda houver mock ou regra de gatilho solta no front, ele sai aqui e a substituição vai para "Impacto em fases seguintes" |
| D10 | Onde mora a matriz de cobertura dos 28 casos do §10? | Neste arquivo · `docs/runbook.md` · arquivo novo | Neste arquivo, na seção de edge cases, preenchida no encerramento — fica colada ao aceite que a exige e não cria mais um documento para envelhecer |
| D11 | Com n ≥ 10, o fallback de 80% do timeout continua valendo em paralelo ao p95? | Exclusivo (só p95) vs. `OU` dos dois | Exclusivo, como o §12 escreve. Se a calibração mostrar que uma skill com p95 alto engole duração patológica, isso é mudança de regra: para o plano e Apêndice B antes do código |

## Etapas

### F7.1 — Motor de gatilhos e limiares em `config`

**Entrega:** avaliador único, chamado ao fechar cada correção, que devolve os códigos de gatilho, persiste em `correcoes.gatilhos` e força `aguardando_revisao` quando a lista não é vazia.

**Arquivos:** `packages/shared/src/gatilhos.ts`, `apps/api/src/gatilhos/` (service + uma regra por arquivo)

**Tarefas**

- [ ] Declarar os códigos em `packages/shared`: `devolutiva_longa`, `devolutiva_similar`, `modo_avaliacao_divergente`, `execucao_ausente`, `historico_nao_avaliado`, `duracao_anomala` — a UI da F6 importa daqui, sem string solta no front (D9)
- [ ] Escrever o avaliador recebendo correção, dossiê, linha do `skills_map` e limiares já lidos; cada regra é função pura, com a consulta ao histórico feita fora e injetada
- [ ] Ligar o avaliador ao passo 6 do §9.2, **antes** da aplicação da política de revisão (§2.7)
- [ ] Acrescentar `duvidas_do_agente` quando `dossie.duvidas` não é vazio — o §12 diz que os programáticos "somam-se aos autorrelatados", e sem isso a agregação 3+ não enxerga skill ambígua (§10.27)
- [ ] Conferir que as chaves de limiar já semeadas na F1.7 existem no banco em uso e são lidas por nome, sem renomear nenhuma; banco criado antes da F1.7 precisa de migration de dados, que é o único caso em que esta etapa escreve em `config`
- [ ] Regra que lança não derruba o fechamento da correção: loga com `submissao_id`/`job_id`, grava evento e segue com as demais — perder correção é bug (§2.8)
- [ ] Conferir que a métrica `gatilhos por tipo` do §12 — já entregue pelo endpoint de métricas da F5 e vazia até aqui — passa a devolver contagem assim que `correcoes.gatilhos` é persistido: o endpoint da F5 não muda, o que faltava era o dado

**Testes:** tabela caso → conjunto esperado de códigos (nenhum, um, vários simultâneos); política `nenhuma` + gatilho ⇒ `aguardando_revisao`; regra que lança não impede as outras.

**Pronto quando:** correção com dossiê limpo fecha com `gatilhos = {}` e vai para `pronta_envio` sob política `nenhuma`; a mesma com um gatilho forçado vai para `aguardando_revisao`, e a métrica `gatilhos por tipo` do dashboard deixa de vir vazia.

### F7.2 — Gatilho de tamanho da devolutiva

**Entrega:** `devolutiva_longa` disparando pelos limiares globais do §10.25, medidos sobre `devolutivas.texto_agente`.

**Arquivos:** `packages/shared/src/texto.ts`, `apps/api/src/gatilhos/regras/tamanho.ts`

**Tarefas**

- [ ] Implementar contagem de frases e de caracteres conforme D6, com a regra explicada em comentário de "por quê" e travada por teste
- [ ] Aplicar os limiares exatos: veredito aprovado dispara acima de **5 frases** OU **700 caracteres**; reprovado dispara acima de **20 frases**; demais vereditos conforme D5
- [ ] Ler os três valores de `config` a cada avaliação, sem cache de processo — calibrar (F7.11) é mudar linha no banco e valer no próximo fechamento
- [ ] Gravar no evento o número medido de frases e caracteres, que é o insumo da calibração

**Testes:** fronteiras exatas (5 e 6 frases; 700 e 701 caracteres; 20 e 21 frases); devolutiva com bullets; devolutiva com bloco de código.

**Pronto quando:** aprovado com 6 frases dispara e com 5 não; reprovado com 21 dispara e com 20 não; mudar o valor em `config` muda o resultado sem reiniciar a API.

### F7.3 — Gatilho de similaridade (`pg_trgm`)

**Entrega:** `devolutiva_similar` quando o rascunho se parece demais com devolutiva já gerada da mesma skill (§10.24).

**Arquivos:** migration Prisma do índice GIN, `apps/api/src/gatilhos/regras/similaridade.ts`

**Tarefas**

- [ ] Migration Prisma criando índice GIN `gin_trgm_ops` sobre `devolutivas.texto_agente` (a extensão já vem da F1; nada de SQL fora de migration — regra dura 4)
- [ ] Query com `similarity()` filtrando pelo mesmo `skill_slug`, excluindo a própria devolutiva e a linhagem do aluno conforme D7, com janela limitada e timeout na query
- [ ] Limiar inicial **0.6** lido de `config` (§12); dispara quando o maior escore ≥ limiar
- [ ] Gravar no evento o escore e o `submissao_id` do par mais parecido, para o revisor olhar os dois lado a lado

**Testes:** integração contra o Postgres do compose de dev (trigram não se mocka): textos quase idênticos disparam; textos distintos não; reenvio do mesmo aluno (§9.5) não dispara.

**Pronto quando:** duas devolutivas quase iguais da mesma skill fazem a segunda sair com `devolutiva_similar`, com escore e par registrados no evento.

### F7.4 — Gatilhos de coerência dossiê × `skills_map`

**Entrega:** `modo_avaliacao_divergente` e `execucao_ausente` — as duas verificações que o §7 define "além do schema" e que o §13 atribui a esta fase.

**Arquivos:** `apps/api/src/gatilhos/regras/coerencia.ts`

**Tarefas**

- [ ] Regra 1: `dossie.modo_avaliacao` ≠ `skills_map.modo_avaliacao` do par (projeto, fase) da submissão ⇒ `modo_avaliacao_divergente`
- [ ] Regra 2: skill de modo `execucao` com `dossie.execucao.executou = false` ⇒ `execucao_ausente` (§10.26)
- [ ] Garantir que nenhuma das duas invalida o dossiê nem muda o status da correção: validação estrutural e retry corretivo seguem sendo do validador da F3 (§7); aqui o efeito é só forçar revisão
- [ ] Gravar no evento os dois valores comparados — insumo para corrigir o CSV digitado à mão (§17.1 e a observação do STATUS.md sobre `modo_avaliacao`)

**Testes:** matriz 2×2 de modos (skill × dossiê); `executou = false` em skill `estatica` não dispara; dossiê divergente mantém a correção `concluida`.

**Pronto quando:** correção de skill `execucao` cujo dossiê declara `estatica` sai com `modo_avaliacao_divergente` e em `aguardando_revisao`, sem retry corretivo nem falha de validação.

### F7.5 — Gatilho de histórico não avaliado

**Entrega:** `historico_nao_avaliado` sempre que o clone caiu no fallback shallow (§10.17, Apêndice B (06/08) item 8).

**Arquivos:** `apps/api/src/gatilhos/regras/historico.ts`

**Tarefas**

- [ ] Regra direta: `dossie.historico_nao_avaliado === true` ⇒ gatilho, sem limiar e sem mapa de skills
- [ ] Conferir com o cenário G10 que o entrypoint do runner realmente marca o campo no fallback; se não marcar, é bug de F2/F3 — corrigir lá e registrar no STATUS.md, não compensar aqui

**Testes:** flag `true` dispara; `false` e ausente não disparam.

**Pronto quando:** um dossiê de teste com `historico_nao_avaliado: true` produz o gatilho e força `aguardando_revisao`, com o caso oposto (`false`) não disparando — verificável nesta etapa, sem depender da fixture G10 da F7.9.

### F7.6 — Gatilho de duração anômala (regra dupla)

**Entrega:** `duracao_anomala` com os dois braços do §12, escolhidos pelo tamanho da amostra da skill.

**Arquivos:** `apps/api/src/gatilhos/regras/duracao.ts`

**Tarefas**

- [ ] Contar as correções `concluida` **anteriores** da mesma skill; com n ≥ 10, dispara se `duracao_s` > p95, calculado no Postgres com `percentile_cont(0.95) WITHIN GROUP (ORDER BY duracao_s)`
- [ ] Excluir a correção corrente da população do p95 — incluí-la faz o p95 de 10 valores ser praticamente o próprio máximo, e o gatilho nunca dispara
- [ ] Com n < 10, dispara se `duracao_s` > 0,8 × timeout efetivo, onde timeout efetivo = `skills_map.timeout_s ?? config.timeout_job_padrao_s` (§10.9) — sem literal de segundos no código
      · `duracao_s` inclui o jitter de start de 5–15s (§8), enquanto o timeout do §10.9 é contado do start do runner (F2.5, Apêndice B v1.8 item 2). Para os timeouts reais (600s a 1500s) o viés é de 1% a 2,5% e não muda o gatilho — mas é a explicação de por que uma correção pode disparar por 3 segundos de margem, e é o tipo de coisa que se perde três meses depois
- [ ] Ler `gatilho_duracao_min_amostras` (10) e `gatilho_duracao_fracao_timeout` (0,8) de `config`, semeadas na F1.7; o timeout segue vindo do `skills_map` (§5) e nenhum limiar novo entra naquela tabela (Apêndice B v1.3 item 4). Os dois braços são exclusivos (D11) e o evento registra qual decidiu, com o número usado

**Testes:** fronteira n = 9 (fallback) e n = 10 (p95); skill com `timeout_s = 600` dispara em 481s e não em 480s; skill sem override dispara em 1201s; duração injetada, sem `sleep`.

**Pronto quando:** as quatro asserções de fronteira passam e o evento diz, em texto, qual regra foi aplicada.

### F7.7 — Agregação "3+ mesmo gatilho no run"

**Entrega:** endpoint de agregação por (run, gatilho) — o que o banner da F6 consome — e notificação única ao cruzar o limiar (§10.27).

**Arquivos:** `apps/api/src/gatilhos/agregacao.service.ts`, controller do módulo de runs

**Tarefas**

- [ ] Query de agregação por `run_id` × código, contando correções distintas, exposta em rota própria — é o endpoint de agregação que a F6 já deixou ligado ao componente de banner, oculto enquanto a rota devolvia vazio (D9). Não é o `GET /api/metricas/dashboard` da F5: a métrica `gatilhos por tipo` conta por código no geral, a agregação do §10.27 conta por (run, gatilho) e tem limiar
- [ ] Provar o banner ponta a ponta com a UI da F6: com a agregação populada ele sai do oculto e mostra o tipo do gatilho e o link para a lista filtrada — a prova do banner é aceite desta fase (A5), não da F6
- [ ] Emitir a notificação **uma única vez** por (run, gatilho) ao cruzar o limiar; ocorrências seguintes atualizam a contagem do banner sem notificar de novo
- [ ] Ler `gatilho_agregacao_min_ocorrencias` (3) de `config`, semeada na F1.7
- [ ] Emitir SSE nos tópicos que o §12 já define (`notificacao.created`, `run.updated`), sem inventar tópico novo

**Testes:** 2 ocorrências não notificam; a 3ª notifica; a 4ª não notifica de novo; gatilhos diferentes contam separado; dois runs não se misturam.

**Pronto quando:** run com 3 correções marcadas `devolutiva_similar` tem exatamente 1 linha em `notificacoes`, o endpoint de agregação devolve contagem 3 e o banner da F6 — oculto até então — aparece.

### F7.8 — Harness dos golden repos (zip → bare → `file://`)

**Entrega:** script idempotente que restaura as fixtures congeladas e devolve URLs `file://` clonáveis pelo runner (§14).

**Arquivos:** `scripts/golden/restore.ts`, `tests/fixtures/golden/manifesto.json`, `.env.example`

**Tarefas**

- [ ] Registrar `GOLDEN_DIR` no `.env.example` **sem valor real** (regra dura 5), com o mesmo comentário de diretório externo já usado para `SKILLS_DIR`: as fixtures são código de terceiro (§11), moram fora desta árvore e não são versionadas aqui (D1)
- [ ] Para cada zip em `$GOLDEN_DIR` (D1): descompactar em área de trabalho e produzir `$GOLDEN_DIR/bare/G<n>.git` via `git clone --bare`; rodar duas vezes não duplica nem corrompe
- [ ] Publicar as URLs como `file://$GOLDEN_DIR/bare/G<n>.git` e registrar no manifesto versionado o SHA de HEAD de cada fixture — o zip fica fora do repo, o SHA é o que torna o teste reprodutível
- [ ] Tornar o bare visível dentro do runner conforme D2, sem alterar o `docker run` do §8 além do mount condicional
- [ ] Registrar no manifesto as fixtures que **não** precisam de zip: G4 (linha de `skills_map` com `base_repo_url` igual à URL submetida — nenhum clone acontece), G5 (URL `file://` inexistente), G6 (par projeto+fase fora do `skills_map`); expor `pnpm golden:restore`

**Testes:** teste do harness que restaura, clona via `file://` e confere o SHA contra o manifesto.

**Pronto quando:** `pnpm golden:restore` deixa os bares em `$GOLDEN_DIR/bare` e `git clone file://…` de cada um funciona **de dentro do runner**, não só no host.

### F7.9 — Suite E2E: golden G1–G10 e cenários de resiliência

**Entrega:** `pnpm test:e2e` roda as dez fixtures do §14 e os cenários de resiliência fim a fim, relatando estado, veredito e gatilhos de cada um.

**Arquivos:** `scripts/e2e/run.ts`, `scripts/e2e/cenarios/g*.ts`, `scripts/e2e/cenarios/caso-*.ts`

**Tarefas**

- [ ] Um cenário por fixture, criando a submissão pelo mesmo caminho da API que o intake usa (§9.1) — nunca por `INSERT` direto, senão o teste não prova o sistema; cada cenário marcado `llm` ou `fake` (D4)
- [ ] Asserções de comportamento, não de texto: G1 afirma veredito aprovado; G2 afirma ≥ 1 critério `falha` com `evidencia` não-vazia (§7); G3 afirma que nenhum container de stack subiu; G7 afirma override sem `ports:` e sem `container_name:` (§10.14–15)
- [ ] G4, G5 e G6 são fixtures de dados e nenhuma delas pode criar container `fc-job-*`: G4 termina em `link_invalido` com `status_detalhe` de link do repositório base e devolutiva gerada por template com `correcao_id` **nulo** (§10.2, §6, §5); G5 termina em `link_invalido` depois das 2 tentativas de `ls-remote` (§10.1); G6 termina em `sem_skill` com linha em `notificacoes` criada (§10.3, §6)
- [ ] G8 roda a mesma fixture 2× em paralelo (ausência de colisão na 8080, §10.13); G9 afirma repo do aluno limpo após o lint (§10.16); G10 usa o timeout de clone rebaixado (D3) e afirma `historico_nao_avaliado`
- [ ] Caso 5: nova submissão do mesmo aluno+projeto+fase durante `corrigindo` ⇒ anterior `substituida`, runner morto, teardown feito, nada enviado
- [ ] Caso 7: dossiê inválido forjado ⇒ 1 retry corretivo via `docker exec` + `--resume` sem incrementar `retry_n`; segunda falha consome retry (§7)
- [ ] Caso 9: `timeout_s` rebaixado ⇒ 3 execuções ⇒ `erro`, com transcript preservado e job dir **mantido** (§11 — apagá-lo é o bug)
- [ ] Caso 10: erro de limite forjado na saída do CLI ⇒ pausa global + notificação + correção `nao_executada` sem consumir retry + retomada
- [ ] Caso 12: matar a API com correção `rodando` ⇒ no boot, correção `falhou` ("órfã pós-reinício"), submissão volta para `na_fila`, janitor limpa container e network órfãos
- [ ] Disco (§14, §10.19): limiares rebaixados artificialmente ⇒ alerta no primeiro patamar e pausa global no segundo
- [ ] Limpeza ao fim de cada cenário por label `fc.job=<id>` / prefixo `fc-job-`, jamais prune (regra dura 1); relatório final por cenário com estado, gatilhos, duração e caminho do transcript

**Testes:** a suite é o teste; o que nasce em `tests/` é o harness da F7.8 e as regras puras das etapas anteriores.

**Pronto quando:** `pnpm test:e2e` em máquina limpa termina com as 10 fixtures e os 6 cenários no resultado esperado, e `docker ps -a --filter label=fc.job` e `docker network ls --filter name=fc-job-` voltam vazios.

### F7.10 — Backup diário e restauração

**Entrega:** cron do pg-boss às 03:00 gerando dump em `./backups` com retenção de 14, e restauração já executada uma vez (§12).

**Arquivos:** `apps/api/src/backup/`, `.gitignore`

**Tarefas**

- [ ] Registrar o job cron no pg-boss (`backup-diario`, 03:00) cravando o fuso America/Sao_Paulo explicitamente — o banco guarda UTC (CLAUDE.md)
- [ ] Executar o `pg_dump` por `execFile`, nunca `exec` com string montada; arquivo comprimido e nomeado com timestamp
- [ ] Retenção: manter os 14 arquivos mais recentes e apagar o excedente por contagem/idade no diretório de backup; `backups/` no `.gitignore`, porque o dump carrega nome e e-mail de aluno (§11)
- [ ] Falha do dump gera notificação, não silêncio; handler idempotente (pg-boss pode executar duas vezes)

**Testes:** retenção com relógio injetado (o 15º arquivo remove o mais antigo); processo de dump falhando vira notificação; execução dupla é inofensiva.

**Pronto quando:** o job roda sob demanda, gera arquivo em `backups/`, e restaurar esse arquivo em banco vazio reproduz as tabelas com dado.

### F7.11 — Fechamento: calibração, runbook e passada final no §10

**Entrega:** limiares com origem registrada, `docs/runbook.md` escrito e executado, e os 28 casos do §10 com cobertura confirmada um a um. Nenhum código novo de produção aqui — ajuste de dado e documentação.

**Arquivos:** linhas da tabela `config`, `docs/runbook.md`, `docs/STATUS.md`, este arquivo

**Tarefas**

- [ ] Coletar, por gatilho, quantas correções dispararam na suite e com que valor medido (os eventos de F7.2–F7.6 existem para isso); ajustar os valores em `config`, nunca em código, registrando antigo → novo e o porquê no STATUS.md
- [ ] Registrar a limitação: 10 fixtures são amostra pequena, o número calibrado é ponto de partida e a revisão real vem do primeiro run de volume — escrever isso vale mais do que fingir precisão
- [ ] Escrever no runbook os cinco procedimentos que o §12 nomeia: `.wslconfig` (`processors=6`, `memory=10GB`, `swap=8GB`), desativar suspensão durante runs (§10.28), rodar `claude setup-token` e atualizar o `.env` (§10.11), recuperar de disco cheio (§10.19 — limpeza por label, nunca prune), restaurar backup
- [ ] Acrescentar o que a operação diária precisa e o plano não listou por não existir ainda: despausar a pausa global, rodar a suite golden antes de trocar prompt/skill/modelo (§14), ler o transcript de uma correção que falhou
- [ ] **Poda global do Docker — cache de build e imagens dangling —, que saiu do janitor nas v1.8 e v1.9 do plano** (Apêndice B v1.8 item 1 e v1.9 item 1; D8 da F2). O janitor só toca no que é `fc-job-*`, porque a máquina é de trabalho e roda os containers de outros projetos do operador. O runbook documenta os dois comandos, quando rodá-los e por que são **decisão humana**, não rotina: `docker builder prune` e a poda de dangling alcançam o Docker inteiro, e com o socket do host montado no runner (§11) uma rotina automática que os dispare tem alcance total. Deixar explícito no texto que o sistema **nunca** roda nenhum dos dois sozinho — é o que o operador precisa saber para confiar a máquina dele ao sistema
- [ ] Executar cada procedimento uma vez na máquina e corrigir o texto onde ele mentir — runbook não testado é ficção
- [ ] Percorrer os 28 casos do §10 e preencher a matriz de cobertura (caso → etapa/fase que trata → teste ou cenário que prova), conforme D10; caso sem cobertura vira tarefa aqui se for buraco de implementação, ou item do STATUS.md (e Apêndice B, se mexer em arquitetura) se for decisão faltando — nunca marcar "coberto" no otimismo

**Testes:** nenhum — calibração muda dado e o runbook se verifica por execução; os testes de F7.2–F7.6 já travam que o limiar vem de `config` e não de constante.

**Pronto quando:** nenhum limiar de gatilho aparece hard-coded no código da API (grep por `0.6`, `700`, `20`, `0.8` e `3` só acha teste e seed), o runbook tem os cinco procedimentos executados ao menos uma vez, e a matriz do §10 tem 28 linhas sem nenhuma "a verificar".

## Edge cases do §10 cobertos aqui

A matriz completa dos 28 casos é entrega da F7.11 e é preenchida aqui no encerramento (D10). Abaixo, os que esta fase trata ou prova:

| # | Caso | Como esta fase trata | Onde é verificado |
|---|---|---|---|
| 1 / 2 / 3 | Repo inacessível · link do repo base · sem skill | Fixtures de dados G5, G4 e G6, sem clone (F7.8), com asserção de estado, devolutiva e notificação na F7.9 | A1 |
| 5 / 7 / 9 / 12 | Substituição · dossiê inválido · timeout · queda no meio | Cenários de resiliência da F7.9, cada um nomeado pelo caso | A2 |
| 10 / 11 | Limite do plano · token expirado | Erro de limite forjado ⇒ pausa global + `nao_executada` + retomada | A3 |
| 13 / 14 / 15 | Porta fixa · `ports:` publicadas · `container_name:` fixo | Fixtures G8 e G7 na suite (F7.9) | A1 |
| 16 | `lint --fix` reescreve o repo do aluno | Fixture G9 afirma repo limpo ao final | A1 |
| 17 | Repo gigante / clone lento | G10 com timeout de clone rebaixado ⇒ `historico_nao_avaliado` (F7.5) | A1 |
| 19 | Disco enchendo | Cenário com limiares rebaixados: alerta e pausa (F7.9) | A2 |
| 24 | Devolutiva quase idêntica à de outro aluno | Gatilho `devolutiva_similar` (F7.3) | A4 |
| 25 | Devolutiva longa demais | Gatilho `devolutiva_longa` com limiares globais (F7.2) | A4 |
| 26 | Skill exige execução, dossiê diz que só leu | Gatilhos de coerência (F7.4) | A4 |
| 27 | 3+ correções com o mesmo gatilho no run | Agregação + banner + notificação única (F7.7) | A5 |
| 28 | WSL suspende no meio | Runbook: desativar suspensão durante runs (F7.11) | A9 |

## Critérios de aceite

**Esta seção é a fonte da verdade do "pronto" desta fase** (o §13 do plano aponta para cá).

| # | Critério | Como provar | Evidência esperada |
|---|---|---|---|
| A1 | Suite golden G1–G10 verde em execução limpa | `pnpm golden:restore && pnpm test:e2e` | 10 fixtures no estado esperado (G4 e G5 em `link_invalido`, G6 em `sem_skill`, as três sem nenhum container `fc-job-*` criado); zero container/network `fc-job-*` restante |
| A2 | Casos 5, 7, 9, 12 e disco simulados passam | `pnpm test:e2e --only=resiliencia` | Estado final de cada cenário no relatório + job dir de correção `falhou` ainda presente |
| A3 | Caso 10 passa: limite do plano | Cenário com erro de limite forjado na saída do CLI | Pausa global ativa, notificação criada, correção `nao_executada` sem incremento de `retry_n`, fila retomada |
| A4 | Casos 24, 25 e 26 forçam revisão nas fronteiras | Testes de fronteira + cenários de gatilho | Similaridade com escore no evento; 6 frases dispara e 5 não; 21 dispara e 20 não; coerência com correção ainda `concluida` |
| A5 | Caso 27: agregação notifica uma vez e o banner da F6 acende | Run com 3 correções do mesmo gatilho | 1 linha em `notificacoes`, contagem 3 no endpoint de agregação, banner da F6 saindo do oculto, e `gatilhos por tipo` do dashboard deixando de vir vazio |
| A6 | Duração anômala respeita a regra dupla | Testes de fronteira n=9 / n=10 e timeout com e sem override | Quatro asserções passando + evento indicando o braço aplicado |
| A7 | Gatilho força revisão mesmo com política `nenhuma` | Run com política `nenhuma` e uma correção com gatilho | Submissão em `aguardando_revisao`, não em `pronta_envio` (§2.7) |
| A8 | Backup gera e restaura | Disparar o job sob demanda e restaurar em banco vazio | Arquivo em `backups/`, retenção em 14, tabelas restauradas conferidas |
| A9 | Runbook executado, não só escrito | Rodar os cinco procedimentos do §12 | `docs/runbook.md` com cada procedimento marcado como executado e corrigido onde divergiu |
| A10 | Matriz do §10 fechada | Passada final da F7.11 | 28 linhas com caso → etapa → prova; nenhuma "a verificar" |
| A11 | Definição de pronto da skill | `pnpm lint && pnpm typecheck && pnpm test` | Três verdes, sem TODO solto nem arquivo morto |

- [ ] A1
- [ ] A2
- [ ] A3
- [ ] A4
- [ ] A5
- [ ] A6
- [ ] A7
- [ ] A8
- [ ] A9
- [ ] A10
- [ ] A11

## Testes que nascem nesta fase

- **Contagem de frases e caracteres** (`packages/shared`): trava a regra do D6 contra bullets, blocos de código e abreviações com ponto.
- **Avaliador de gatilhos** (unidade pura): tabela caso → conjunto de códigos, incluindo lista vazia, combinação de vários e regra que lança sem derrubar as outras.
- **Regras de fronteira**: tamanho (5/6, 700/701, 20/21), duração (n=9 vs. n=10; `timeout_s` com e sem override), agregação (2/3/4 ocorrências).
- **Similaridade** (integração com o Postgres do compose de dev, porque `pg_trgm` é do banco): dispara em textos quase iguais, não dispara em textos distintos, não dispara no reenvio do mesmo aluno.
- **Política × gatilho**: política `nenhuma` com gatilho não-vazio termina em `aguardando_revisao` — a trava do §2.7 virando teste.
- **Backup**: retenção com relógio injetado e idempotência do handler (pg-boss pode executar duas vezes).
- **Harness golden**: restaura, clona via `file://` e confere o SHA do manifesto — é o que impede a fixture de mudar sem ninguém ver.
- **Cenários E2E e de resiliência**: um script por fixture e um por caso do §10, nomeados em linguagem de domínio, com asserção de estado e gatilho, nunca de texto de devolutiva.

## Riscos e armadilhas

- **A suite consome plano Max.** G1–G3 rodam o agente de verdade e podem disparar a própria pausa global do §10.10 no meio (§15, risco 1). O runner da suite precisa distinguir "pausa por limite" de "falha do cenário" — senão a suite fica vermelha por motivo legítimo e ninguém confia mais nela.
- **Não-determinismo do LLM.** A suite golden é regressão de comportamento (§14): asserção de texto literal quebra a cada execução. Afira veredito, estado, evidência e gatilhos.
- **`file://` e propriedade do repositório.** O bare é criado pelo usuário do host e o runner roda como `corrector` (uid 1000): `git` pode recusar com *dubious ownership*. Trate no entrypoint, não desligando verificação global no host.
- **`similarity()` cai com texto longo.** Devolutiva de 700+ caracteres raramente chega a 0.6 de trigram; se o gatilho nunca disparar, o problema é o limiar, não a regra — e o índice GIN acelera o operador `%`, não a função isolada.
- **Reenvio do aluno é falso positivo garantido** na similaridade se a linhagem do §9.5 não for excluída (D7).
- **`pg_dump` pode não existir no host.** O Postgres roda em container; sem o cliente 16 no WSL, o dump sai por `docker compose exec -T` no serviço do banco. Cliente de versão diferente do servidor falha feio e tarde.
- **Node fora do PATH em shell não-interativo** (STATUS.md): o cron do backup e os scripts da suite chamam `node`/`pnpm`. Caminho absoluto ou `corepack` no PATH do serviço — não confie no `nvm.sh`.
- **Zips golden são binários e o guard de segredo é cego a binário** (STATUS.md): `.env` de aluno dentro de um zip entra no repo sem alarme. É o argumento central do D1.
- **Suspensão do WSL durante a suite** (§10.28): a suite é longa; máquina dormindo derruba jobs em voo e o resultado parece bug do sistema.
- **Calibrar com 10 fixtures é amostra pequena.** Assuma e escreva; limiar calibrado em dado pobre com aparência de precisão é pior do que limiar declaradamente provisório.

## O que NÃO entra nesta fase

- Auth, deploy fora do WSL, socket proxy, egress restrito, métricas avançadas, retenção revisada → F8
- Driver `fc_platform`, webhook ativo, envio automático real → F9
- Estado ou transição novos na máquina do §6 → exigem plano + Apêndice B antes de qualquer código (regra dura 3)
- Limiar de gatilho por skill (coluna em `skills_map`) → contraria o Apêndice B v1.3 item 4; limiar é global em `config` e não vai para fase nenhuma
- Reescrita do `prompt-template.md` ou de skills `corrige-*` para reduzir disparo de gatilho → o template é da F3 e a skill é conteúdo externo; mudança lá obriga a rodar esta suite de novo (§14)
- Fixtures novas além de G1–G10 → o §14 fixou dez; fixture nova é decisão de plano, não de implementação
- Endpoint de métricas do dashboard e componente do banner 3+ → já entregues por F5 e F6; aqui nasce só o endpoint de agregação do §10.27 e o dado que faltava à métrica `gatilhos por tipo`
- Meta numérica de cobertura de testes → não é alvo (CLAUDE.md e skill `implementar-fase`)

## Impacto em fases seguintes

A preencher no encerramento da fase.

| O que mudou aqui | Fase afetada | O que foi atualizado lá |
|---|---|---|

## Registro de execução

A preencher durante a fase.

- **Iniciada em:** —
- **Concluída em:** —
- **Decisões tomadas:** (D1–D11 resolvidas, com link para o STATUS.md; se alguma mudar arquitetura, também no Apêndice B)
- **Divergências do plano:** —
- **Evidência dos aceites:** (relatório da suite, saída dos cenários de resiliência, arquivo de backup restaurado)
