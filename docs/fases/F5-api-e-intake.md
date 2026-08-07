# F5 — API e intake

> **Status:** ⬜ não iniciada
> **Estimativa:** 2–3 dias úteis (plan §13)
> **Depende de:** F1 (banco) · F4 (fila e máquina de estados)
> **Destrava:** F6 (a SPA só consome o que existe aqui) · F7 (E2E entra pela API) · F9 (drivers e receptor dormante)
> **Seções do plano:** §9.1 (intake manual) · §9.2 passo 1 (validação da submissão) · §9.4 (envio) · §9.5 (nova tentativa) · §6 e §6.1 (transições cujo ator é a API) · §5 (modelo de dados) · §12 (tópicos SSE, métricas do dashboard) · §3 (drivers, webhook dormante) · §11 (PII) · §10.1–3, §10.5, §10.6, §10.21–23

## Objetivo

No fim da fase o sistema tem superfície HTTP: dá para colar blocos do admin, ver o preview validado
linha a linha, confirmar e ver as submissões nascerem em `recebida` e saírem sozinhas para `na_fila`,
`link_invalido` ou `sem_skill`; dá para ler fila, correções, dossiês e devolutivas, conduzir o ciclo
de vida do run, editar e aprovar uma devolutiva, marcar como enviada e acompanhar tudo ao vivo por
SSE. Nada disso tem tela ainda (F6) — é tudo REST verificável por `curl`.

## Pré-condições

- [ ] F4 marcada ✅ em `docs/fases/README.md` — as transições do §6 já existem persistidas e a F5 apenas as dispara, inclusive as `validando → {link_invalido, sem_skill, na_fila}` que o serviço de validação da F5.7 chama
- [ ] `main.ts`, `AppModule`, módulo de configuração, logger pino e exception filter de domínio existem (entrega da F4.0) e `pnpm --filter api build` passa — criar shell de aplicação não é entrega desta fase (**D1**)
- [ ] Postgres de dev de pé: `docker compose up -d` e `docker compose ps` com o serviço `healthy`
- [ ] `skills_map` semeado (F1): `select count(*) from skills_map where ativo` ≥ 1 — sem isso o preview não resolve skill nenhuma e o aceite A2 não roda
- [ ] `config` tem a chave `devolutiva_link_invalido_template`, semeada pela F1.7; se faltar, rodar `pnpm db:seed` — nunca alterar o banco à mão (regra dura 4)
- [ ] Pelo menos 5 blocos reais do admin coletados e **anonimizados** (nome e e-mail trocados, forma e rótulos preservados) — fixture do aceite A2; PII de aluno não entra em arquivo versionado (§11)
- [ ] `pnpm lint`, `pnpm typecheck` e `pnpm test` verdes antes da primeira linha

## Decisões do plano que esta fase materializa

| Decisão | Onde está | Consequência prática nesta fase |
|---|---|---|
| Intake manual é feature definitiva, não paliativo | §9.1, `docs/INTEGRATION.md` | Parser e preview são código de produção com suite de testes, não script de apoio |
| Confirmar o preview cria a submissão já em `recebida`, e a validação dispara automática | §6, Apêndice B (06/08) item 4 | `POST /intake/preview` não escreve no banco; `POST /intake/confirmar` escreve e dispara o serviço de validação da F5.7 |
| A validação é `ls-remote` + comparação com o repo base + pin do SHA + resolução da skill | §9.2 passo 1, §6, §10.1–3 | O serviço é desta fase (F5.7) e chama as transições `validando → …` entregues pela F4 |
| `Celular:` é descartado no parser e nunca persiste | §5, §11, regra dura 6 | O tipo de saída do parser **não tem** campo de celular — impossível persistir, não proibido |
| SSE é notificação; REST é a fonte da verdade | §10.22, §12 | Sem buffer de replay; heartbeat e reconexão com refetch pelo cliente |
| `texto_agente` é imutável; edição humana vai em `texto_final` | §5, regra dura 7 | O DTO de edição de devolutiva só aceita `texto_final` e `veredito_final` |
| `devolutivas.correcao_id` é nullable por causa de `link_invalido` | §5, Apêndice B v1.3 item 2 | O renderizador do template cria devolutiva sem correção associada |
| Envio manual (copiar + marcar enviada) é o comportamento definitivo da origem `manual` | §9.4 | `EnvioDriver` manual fecha o fluxo; nenhum stub de `fc_platform` é escrito |
| O humano é a autoridade sobre o veredito | §9.3 | `veredito_final` pode divergir do agente e ambos ficam registrados |
| No máximo 1 run ativo por vez | §10.21 | `POST /runs` responde 409 com motivo legível quando já há run ativo |
| "Ativo" é definido por complemento dos terminais | §5, Apêndice B v1.3 item 1 | O aviso de duplicata do preview usa essa definição, não uma lista própria |

## Decisões a tomar nesta fase

| # | Pergunta em aberto | Opções | Recomendação |
|---|---|---|---|
| D1 | Onde nasce o shell do Nest, já que `apps/api` existe desde a F1/F2 só como código TS sem DI? | (a) bootstrap completo aqui; (b) uma fase anterior entrega `main.ts`/`AppModule` e a F5 só adiciona controllers | **Resolvida na F4.0** — o bootstrap mínimo (`main.ts`, `AppModule`, configuração, logger pino, exception filter de domínio, shutdown hooks) é da F4, porque a fila é a primeira coisa que precisa de processo com ciclo de vida. A F5 acrescenta controllers, DTOs, SSE e exception filter HTTP sobre o `AppModule` existente |
| D2 | Qual fase é dona de `OrigemDriver`/`EnvioDriver` e do receptor dormante `POST /webhooks/fc`? O §3 os define, o §13 não os atribui | F2 · F5 · F9 | **F5** — a interface nasce junto do único consumidor real (intake e envio manuais) e o receptor é um endpoint + insert; a F9 só acrescenta a implementação `fc_platform` |
| D3 | O parser compara rótulos literalmente ou normalizados? | literal (`Repositório:`) vs. normalizado (trim + minúsculas + sem diacríticos) | Normalizado — o bloco vem colado de navegador/Windows e acento quebrado é rotina; a lista de rótulos aceitos continua sendo a do §9.1 |
| D4 | SSE reenvia eventos perdidos (`Last-Event-ID`)? | com replay vs. sem replay | Sem replay: heartbeat a cada 15s e o cliente refaz fetch ao reconectar (§10.22) |
| D5 | O §13 não lista métricas entre os recursos REST da F5, mas o Dashboard da F6 precisa delas (§12) | nascer aqui vs. na F6 vs. na F7 | `GET /metricas/dashboard` nasce aqui com as **quatro** métricas do §12 — contadores por estado, tempo médio de correção (24h), taxa de aprovação por skill e gatilhos por tipo; a agregação "3+ mesmo gatilho no run" (§10.27) é outra coisa e fica na F7 com os gatilhos |
| D6 | Onde é calculado `attempt_aluno`/`anterior_id` (§9.5)? | intake (F5) vs. worker (F4) vs. prompt (F3) | Na confirmação do intake (F5.6): é ali que existem `aluno_email`+`projeto`+`fase`; a injeção do contexto no prompt continua sendo da F3 |
| D7 | O `git ls-remote` da validação (§9.2 passo 1) é entrega da F4 ou da F5? | F4 (dona da transição `validando`) vs. F5 | **Resolvida: F5 é dona do serviço** (F5.7); a F4 fornece `transicionar()` e as transições `validando → {link_invalido, sem_skill, na_fila}` que o serviço chama. O §6 nomeia a API como ator dessas transições, e a F5 já é dona do parser, do preview, do template em `config` e do `status_detalhe` |
| D8 | Auth, CORS e proteção do webhook no MVP | sem auth vs. token estático | Sem auth (§1 exclui login do MVP); CORS restrito à origem do Vite local; webhook dormante sem validação de assinatura — o header/algoritmo é pergunta aberta do `INTEGRATION.md` §3 — mas com limite de tamanho de body |

## Etapas

### F5.1 — Camada HTTP, validação de DTO e contrato de erro

**Entrega:** a API passa a servir HTTP sobre o `AppModule` da F4.0, responde `GET /api/health` e devolve erro em formato único.

**Arquivos:** `apps/api/src/main.ts`, `apps/api/src/app.module.ts`, `apps/api/src/common/` (o mesmo diretório de infraestrutura criado na F4.0, não um novo)

**Tarefas**

- [ ] Acrescentar a camada HTTP ao `AppModule` já existente (**D1**): `main.ts` passa a escutar porta; bootstrap, módulo de configuração, logger pino e shutdown hooks vêm da F4.0 e não são recriados
- [ ] Habilitar `ValidationPipe` global com `whitelist` e `forbidNonWhitelisted` (campo não declarado no DTO é recusado — é o que impede um `celular` de entrar por engano)
- [ ] Criar o exception filter **HTTP** que traduz as exceções de domínio tipadas da F4.0 em resposta com contrato único; nenhum `throw new Error` cru atravessa a API
- [ ] Serializar `BigInt` na fronteira HTTP: interceptor global (ou `toJSON` no prototype, escolhido uma vez e documentado) convertendo todo id do §5 para string — `JSON.stringify` de `BigInt` lança `TypeError`, problema herdado da F1
- [ ] Prefixo global `/api` e CORS restrito à origem local do Vite; o contexto `submissao_id`/`job_id` do logger da F4.0 passa a ser preenchido também no ciclo de request (§12)
- [ ] Expor `GET /api/health` com checagem de conexão do Prisma

**Testes:** e2e de `health` (200), de DTO inválido (400 no contrato de erro definido aqui) e de contrato de serialização — um recurso com id `bigint` responde 200 com o id como string, sem `TypeError`.

**Pronto quando:** `pnpm --filter api start` sobe, `curl localhost:3000/api/health` retorna 200, um POST com campo desconhecido retorna 400 no formato do filter e nenhuma resposta quebra por `BigInt`.

### F5.2 — Parser de bloco em `packages/shared`

**Entrega:** função pura que converte o texto colado do admin em blocos estruturados, com campos faltantes reportados em vez de exceção.

**Arquivos:** `packages/shared/src/intake/parse-blocos.ts`, `packages/shared/src/intake/parse-blocos.test.ts`

**Tarefas**

- [ ] Normalizar fins de linha `\r\n` e `\r` para `\n` antes de qualquer coisa (blocos vêm do Windows, Apêndice B v1.1) — `linhasDoCsv` de `packages/shared/src/csv/rfc4180.ts` (F1) já faz isso e mais o BOM; reusar ou extrair, nunca reescrever a terceira cópia
- [ ] Separar blocos: uma nova ocorrência de `Projeto:` abre bloco novo (§9.1)
- [ ] Reconhecer os rótulos do §9.1 com os aliases `Fase do projeto:`/`Fase:` e `E-mail:`/`Email:`, aplicando a normalização de **D3**; só o primeiro `:` da linha separa rótulo de valor
- [ ] Descartar `Celular:` no parser: o tipo `BlocoParseado` **não declara** campo de celular (regra dura 6, §11)
- [ ] Ignorar rótulo desconhecido sem quebrar o bloco, devolvendo-o em `desconhecidos[]` para o preview exibir
- [ ] Implementar o fallback de URL por regex quando `Repositório:` não aparece, marcando de onde o valor veio (rótulo × regex)
- [ ] Devolver `faltando: string[]` por bloco em vez de lançar; texto vazio devolve lista vazia
- [ ] Exportar tipos e função no índice do pacote; `api` e `web` importam de lá (nunca duplicar tipo)

**Testes:** a suite mais densa da fase — lista completa em "Testes que nascem nesta fase".

**Pronto quando:** `pnpm test` cobre todos os casos listados e o objeto de saída não possui nenhuma chave de celular (asserção sobre as chaves, não sobre o valor).

### F5.3 — SSE: barramento interno e endpoint

**Entrega:** os quatro tópicos do §12 publicáveis de qualquer service e consumíveis por um cliente HTTP.

**Arquivos:** `apps/api/src/eventos/`

**Tarefas**

- [ ] Criar publisher interno (Subject/Observable) com os tópicos `submissao.updated`, `run.updated`, `notificacao.created`, `sistema.pausa` — nomes exatos do §12
- [ ] Expor `GET /api/eventos/stream` com `@Sse`, `Content-Type: text/event-stream`, sem compressão e sem buffer intermediário
- [ ] Emitir heartbeat a cada 15s para a conexão não morrer em idle (**D4**)
- [ ] Payload de evento carrega apenas identificadores e o novo estado; o cliente busca o detalhe por REST (§10.22)

**Testes:** e2e que abre o stream, dispara uma mudança e recebe o evento do tópico certo; teste de que a queda da conexão não deixa listener pendurado.

**Pronto quando:** `curl -N localhost:3000/api/eventos/stream` mostra heartbeat e recebe `submissao.updated` quando uma submissão muda de estado.

### F5.4 — Fronteiras plugáveis e receptor de webhook dormante

**Entrega:** `OrigemDriver` e `EnvioDriver` existem como interfaces com exatamente uma implementação cada, e o `POST /webhooks/fc` já acumula payload real.

**Arquivos:** `apps/api/src/drivers/`, `apps/api/src/webhooks/`

**Tarefas**

- [ ] Definir `OrigemDriver` (listar pendentes) e `EnvioDriver` (postar devolutiva) em `apps/api`, com implementação `manual` registrada por token de DI (§3, CLAUDE.md — são duas das três fronteiras autorizadas a ter interface)
- [ ] `EnvioDriverManual` marca a devolutiva como enviada e registra evento; não há envio externo (§9.4)
- [ ] Implementar `POST /webhooks/fc` gravando headers e body bruto em `webhook_payloads` e retornando 202, sem interpretar nada (§3, `INTEGRATION.md`)
- [ ] Aplicar limite de tamanho de body no webhook e não validar assinatura (**D8**)

**Testes:** contrato do webhook (payload arbitrário vira linha em `webhook_payloads`, nenhum outro efeito observável).

**Pronto quando:** `POST /api/webhooks/fc` com JSON qualquer retorna 202, a linha existe no banco e nenhuma submissão foi criada.

### F5.5 — Preview do intake

**Entrega:** `POST /api/intake/preview` devolve as linhas parseadas com problemas apontados por linha, sem tocar no banco.

**Arquivos:** `apps/api/src/intake/`

**Tarefas**

- [ ] Endpoint recebe o texto colado, chama o parser da F5.2 e valida cada linha: URL git plausível, e-mail válido, `(projeto, fase)` existente em `skills_map` (§9.1)
- [ ] Aceitar `file://` como URL válida — as fixtures E2E da F7 são bare repos locais clonados por `file://` (§14); rejeitar esquemas não suportados explicitamente
- [ ] Linha sem skill resolvida vem marcada com `skill_sugerida: null`, e `GET /api/skills` alimenta o dropdown de escolha manual (§9.1, §10.3)
- [ ] Avisar duplicata: já existe submissão **ativa** (definição por complemento do §5) para `(aluno_email, projeto, fase)` (§10.5)
- [ ] Avisar quando `repo_url` é igual ao `base_repo_url` da skill resolvida (§10.2) — aviso no preview, a decisão de `link_invalido` é da validação (F5.7, §6)
- [ ] Mostrar a URL **normalizada** ao lado da colada quando as duas diferirem (§10.29): "colado `…/r/tree/master/node` · vamos clonar `…/r`". É o ponto mais barato de correção — o humano confirma antes de qualquer container subir
- [ ] Bloco com campo faltante não invalida os outros: cada linha carrega seus próprios problemas (§10.23)

**Testes:** e2e do preview com bloco completo, bloco sem repositório, par sem skill, duplicata ativa e texto com blocos válidos e inválidos misturados.

**Pronto quando:** colar o texto de 5 blocos devolve 5 linhas, cada uma com seus problemas, e nenhuma linha foi escrita no banco (`select count(*) from submissoes` inalterado).

### F5.6 — Confirmação do intake, run e vínculo de tentativa

**Entrega:** `POST /api/intake/confirmar` cria o run e as submissões em `recebida` e dispara a validação.

**Arquivos:** `apps/api/src/intake/`, `apps/api/src/runs/`

**Tarefas**

- [ ] `POST /api/runs` cria o run com `modelo`, `max_paralelo` (default 2, teto 4) e `politica_revisao`; responde 409 quando já há run ativo (§10.21)
- [ ] `POST /api/intake/confirmar` recebe as linhas já revisadas (incluindo skill escolhida à mão) e cria as submissões em `recebida`, numa transação, vinculadas ao run
- [ ] Recusar a confirmação de linha com campo obrigatório faltando, apontando o índice do bloco (§10.23)
- [ ] Calcular `attempt_aluno` e `anterior_id` por match em `(aluno_email, projeto, fase)` contra a submissão anterior `enviada` (§9.5, **D6**)
- [ ] Disparar a validação de cada submissão criada **depois** do commit da transação e registrar evento de intake em `eventos` — o serviço chamado é entregue na F5.7
- [ ] Emitir `submissao.updated` e `run.updated` no barramento da F5.3

**Testes:** e2e de confirmação (5 blocos → 5 submissões em `recebida`), 409 de segundo run, e teste de unidade do vínculo de tentativa (§9.5) incluindo o caso "anterior ainda ativa" (que é substituição, tratada pela F4).

**Pronto quando:** confirmar 5 blocos cria 5 submissões em `recebida`, todas com `run_id` preenchido e uma linha de evento de intake cada, e o disparo da validação é observável (chamada registrada), mesmo antes de a F5.7 existir.

### F5.7 — Validação da submissão

**Entrega:** submissão criada em `recebida` é validada sozinha e chega a `na_fila`, `link_invalido` ou `sem_skill` sem intervenção humana e sem gastar agente.

**Arquivos:** `packages/shared/src/normaliza-repo-url.ts`, `packages/shared/src/normaliza-repo-url.test.ts`, `apps/api/src/validacao/validacao.service.ts`, `apps/api/src/validacao/git-ls-remote.ts`, `apps/api/src/devolutivas/template-link-invalido.ts`

**Tarefas**

- [ ] Transicionar `recebida → validando` ao receber o disparo da F5.6, pelas transições da F4 (§6) — este serviço nunca escreve `submissoes.status` direto
- [ ] `normalizaRepoUrl(bruta)` em `packages/shared`: função **pura**, sem rede, devolvendo `{ url, ref, subpasta, pr_numero }` (§10.29–31). Deliberadamente burra — corta o caminho a partir de `/tree/`, `/blob/`, `/pull/`, `/commit/`, tira `?query`, `#` e espaço nas pontas, e **passa inalterado** o que não reconhecer, deixando o `ls-remote` decidir. Não tenta adivinhar nem consertar host
- [ ] Rodar a normalização **antes** do `ls-remote` (§9.2 passo 1): sem ela, cerca de 1 em 5 entregas reais falha o passo 1 e vira `link_invalido` com o repositório público perfeitamente acessível na mão
- [ ] Executar `git ls-remote <url normalizada> HEAD` por `execFile` com argv separado — **nunca** `exec` com string montada, porque `repo_url` é entrada de terceiro —, timeout de 30 s por tentativa e no máximo 2 tentativas (§9.2 passo 1, §6, §10.1)
- [ ] Guardar `ref`, `subpasta` e `pr_numero` junto da submissão como observação. O `pr_numero` é **insumo obrigatório** do prompt para as skills que avaliam pull request (§10.30, `corrige-ci-sonarcloud`); `ref` e `subpasta` vão como contexto e **nunca** viram troca de ref — o SHA pinado manda (§9.2, Apêndice A)
- [ ] Falha nas 2 tentativas → `validando → link_invalido` com `status_detalhe` do motivo (§10.1). Quando a URL nem parecer repositório — aplicação publicada, link aleatório — usar `status_detalhe` próprio e o texto específico do §10.31, não o genérico de "inacessível"
- [ ] Pinar `commit_sha` a partir do `HEAD` devolvido pelo `ls-remote` e gravá-lo na submissão — é o SHA que a correção faz checkout (§5, §10.4)
- [ ] Comparar `repo_url` com `skills_map.base_repo_url` da skill resolvida; igualdade → `validando → link_invalido` com `status_detalhe` "link do repositório base" (§10.2)
- [ ] Resolver a skill por `(projeto, fase)` em `skills_map` ativo ou usar a skill escolhida à mão no preview; sem nenhuma das duas → `validando → sem_skill` (§6, §10.3) — a notificação vem da transição (F4)
- [ ] `ls-remote` ok + skill resolvida + SHA pinado → `validando → na_fila` (§6); o enfileiramento em si é da F4
- [ ] Renderizar a devolutiva de `link_invalido` a partir do template global lido de `config`, injetando o motivo, com `correcao_id` **nulo** (§6, §5) — a chave é `devolutiva_link_invalido_template`, semeada na F1.7 — se faltar, o conserto é rodar o seed da F1, nunca alterar o banco à mão (regra dura 4)
- [ ] Emitir `submissao.updated` a cada transição pelo barramento da F5.3

**Testes:** `normaliza-repo-url.test.ts` — tabela entrada→saída com as **formas reais colhidas do admin
em 07/08/2026** (donos anonimizados; o que o teste trava é o formato):

| Entrada | `url` | `ref` | `subpasta` | `pr_numero` |
|---|---|---|---|---|
| `https://github.com/a/r` | igual | — | — | — |
| `https://github.com/a/r.git` | igual | — | — | — |
| `https://github.com/a/r ` (espaço no fim) | `…/a/r` | — | — | — |
| `https://github.com/a/r#` | `…/a/r` | — | — | — |
| `https://github.com/a/r/tree/main` | `…/a/r` | `main` | — | — |
| `https://github.com/a/r/tree/modulo-6-django-api-parte-2` | `…/a/r` | `modulo-6-…` | — | — |
| `https://github.com/a/r/tree/master/node` | `…/a/r` | `master` | `node` | — |
| `https://github.com/a/r/tree/main/src/core/genre` | `…/a/r` | `main` | `src/core/genre` | — |
| `https://github.com/a/r/pull/7` | `…/a/r` | — | — | `7` |
| `https://l01-000.southamerica-east1.run.app/?cep=01310-930` | inalterada | — | — | — |
| `https://gitlab.com/a/r/-/tree/main` (host não previsto) | inalterada | — | — | — |

Mais: e2e dos desfechos a partir de `recebida` (repo `file://` válido → `na_fila` com SHA pinado; URL
`/tree/main` de repo válido → **`na_fila`**, não `link_invalido`; repo inexistente → `link_invalido`
após 2 tentativas; URL que não é repositório → `link_invalido` com o `status_detalhe` do §10.31;
`repo_url` igual ao `base_repo_url` → `link_invalido` com o motivo próprio; par sem skill →
`sem_skill`); unidade do wrapper de `ls-remote` (timeout e contagem de tentativas com relógio
injetado, argv sem shell); renderização do template com cada motivo.

**Pronto quando:** as quatro submissões do teste saem de `recebida` sozinhas para o estado do §6 correspondente, as de `link_invalido` têm devolutiva com `correcao_id` nulo, e nenhum container `fc-job-*` foi criado em nenhum dos quatro caminhos.

### F5.8 — REST de leitura e ciclo de vida do run

**Entrega:** tudo que a F6 precisa ler existe com contrato estável, e o run tem rota para cada transição de `runs.status`.

**Arquivos:** `apps/api/src/submissoes/`, `apps/api/src/correcoes/`, `apps/api/src/notificacoes/`, `apps/api/src/metricas/`, `apps/api/src/runs/`

**Tarefas**

- [ ] `GET /api/submissoes` com filtros por estado, skill, aluno, período e run, paginado (base do histórico da F6)
- [ ] `GET /api/submissoes/:id` com correção vigente, devolutiva vigente e timeline de `eventos` (§9.3)
- [ ] `GET /api/correcoes/:id` devolvendo o dossiê `jsonb` como está e `GET /api/correcoes/:id/transcript` servindo o arquivo de `transcript_path` (§5) com verificação de que o caminho está sob `JOBS_DIR`
- [ ] `GET /api/notificacoes` e `POST /api/notificacoes/:id/lida`
- [ ] `GET /api/runs` (lista, com o ativo identificado) e `GET /api/runs/:id` com configuração, contagem por estado das submissões do lote e progresso
- [ ] `POST /api/runs/:id/cancelar`, `/pausar` e `/retomar` expondo por HTTP as transições **humanas** de `runs.status` (§6.1) entregues na F4. **Não existe rota de finalizar**: `finalizado` é automático quando todo o lote chega a estado terminal (F4.7) — run que o humano quer encerrar com submissão ainda ativa é `cancelado`, não finalizado por desistência. Transição ilegal responde no contrato de erro da F5.1, sem inventar estado
- [ ] Garantir rota de refetch para cada tópico SSE do §12 — em particular `run.updated` → `GET /api/runs/:id`, que é o que torna o evento útil (§10.22)
- [ ] `GET /api/metricas/dashboard` com as **quatro** métricas do §12: contadores por estado, tempo médio de correção nas últimas 24h, taxa de aprovação por skill e gatilhos por tipo (contagem por código em `correcoes.gatilhos`), esta última devolvendo lista vazia enquanto a F7 não popular o campo (**D5**) — e ela não é a agregação "3+ mesmo gatilho no run" (§10.27), que é por (run, gatilho), tem limiar e é da F7
- [ ] Datas serializadas em UTC ISO-8601; a conversão para America/Sao_Paulo é da F6

**Testes:** e2e por endpoint (código de resposta, forma do payload, filtro que exclui de verdade), transição de `runs.status` legal e ilegal pelas rotas de ciclo de vida, métrica `gatilhos por tipo` com `correcoes.gatilhos` vazio devolvendo lista vazia (não erro), e teste de que o transcript fora de `JOBS_DIR` é recusado.

**Pronto quando:** com o banco semeado por um run de teste, cada endpoint responde 200 com dados coerentes, o filtro por estado devolve subconjunto estrito e `POST /api/runs/:id/cancelar` deixa o run em `cancelado` conferível por query, liberando a criação do próximo.

### F5.9 — Revisão, envio e config

**Entrega:** o ciclo humano fecha por HTTP: editar, aprovar, marcar enviada — inclusive o caminho sem agente.

**Arquivos:** `apps/api/src/devolutivas/`, `apps/api/src/config/`

**Tarefas**

- [ ] `PUT /api/devolutivas/:id` aceita **somente** `texto_final` e `veredito_final`; tentativa de alterar `texto_agente` é 400 (regra dura 7)
- [ ] `POST /api/devolutivas/:id/aprovar` leva a submissão de `aguardando_revisao` para `pronta_envio` (§6), com o veredito do revisor podendo divergir do agente (§9.3)
- [ ] `POST /api/devolutivas/:id/marcar-enviada` usa o `EnvioDriver` manual e leva a `enviada`, servindo também à transição `link_invalido → enviada` (§6, §9.4)
- [ ] `POST /api/submissoes/:id/reprocessar` e `POST /api/submissoes/:id/cancelar` expõem as transições do §6 implementadas na F4; `PATCH /api/submissoes/:id/skill` destrava `sem_skill` (§6, §10.3)
- [ ] `GET /api/config` e `PUT /api/config/:chave` com allowlist de chaves editáveis (inclusive o template de link inválido renderizado em F5.7); `POST /api/sistema/pausa` e `/retomar` acionam a pausa global da F4 e emitem `sistema.pausa` (§12)
- [ ] Toda ação humana grava linha em `eventos` (§9.3)

**Testes:** imutabilidade de `texto_agente`; transições permitidas e proibidas por estado de origem; envio da devolutiva de `link_invalido` pela transição própria do §6.

**Pronto quando:** o fluxo editar → aprovar → marcar enviada leva uma submissão até `enviada` só com chamadas REST, e uma submissão em `link_invalido` (com a devolutiva criada em F5.7) chega a `enviada` pela transição própria do §6.

## Edge cases do §10 cobertos aqui

| # | Caso | Como esta fase trata | Onde é verificado |
|---|---|---|---|
| 1 | Repo 404/privado | Validação (F5.7) tenta `ls-remote` 2×, transiciona para `link_invalido` e renderiza a devolutiva do template com o motivo, sem agente | A10, A5 |
| 2 | Aluno colou o link do repo base | Preview avisa quando `repo_url == base_repo_url` da skill (F5.5); a validação (F5.7) confirma a igualdade e leva a `link_invalido` com motivo específico | A10, teste do preview |
| 3 | (projeto, fase) sem skill | Preview marca a linha e oferece `GET /api/skills`; confirmar sem escolher leva a validação (F5.7) a `sem_skill` com notificação; `PATCH .../skill` recupera | A3, A10 |
| 5 | Nova entrega com anterior ativa | Preview avisa duplicata ativa antes da confirmação; a substituição em si é da F4 | Teste do preview |
| 6 | Reenvio após reprovação enviada | `attempt_aluno`+1 e `anterior_id` no confirmar (F5.6, §9.5) | Teste de unidade do vínculo de tentativa |
| 21 | 2º run com um ativo | `POST /api/runs` → 409 com motivo legível | A8 |
| 22 | SSE cai | Sem replay, com heartbeat; REST é a fonte da verdade | A7 |
| 23 | Bloco incompleto/malformado | Parser devolve `faltando[]`; preview aponta por linha; confirmar recusa a linha | A3 |

## Critérios de aceite

| # | Critério | Como provar | Evidência esperada |
|---|---|---|---|
| A1 | Parser cobre bloco real, múltiplos blocos, CRLF, malformado e fallback de URL | `pnpm test packages/shared` | Suite verde com todos os casos da seção de testes |
| A2 | Colar 5 blocos reais do admin gera 5 submissões corretas (§9.1, §6) | `POST /api/intake/preview` → `POST /api/intake/confirmar` com a fixture anonimizada | 5 linhas em `submissoes` com `recebida`, projeto/fase/aluno/e-mail/repo conferidos por query |
| A3 | Bloco sem repositório é apontado na linha do preview (§9.1, §10.23) | Preview com bloco sem `Repositório:` e sem URL no corpo; depois `confirmar` com essa linha | Preview marca `faltando: ["repo_url"]` na linha; confirmar retorna 400 apontando o índice do bloco |
| A4 | `Celular:` presente no bloco não chega ao banco (regra dura 6 do CLAUDE.md, §5, §11) | Preview + confirmar com bloco contendo `Celular:`; depois varrer o banco | Número ausente da resposta do preview e de qualquer coluna/`jsonb`: `pg_dump` + `grep` do número não retorna nada |
| A5 | Caminho sem agente fecha | Levar uma submissão a `link_invalido` pela validação (F5.7) e chamar `marcar-enviada` | Devolutiva com `correcao_id` nulo e texto do template com o motivo; submissão em `enviada` |
| A6 | `texto_agente` é imutável | `PUT /api/devolutivas/:id` com `texto_agente` no corpo | 400 do `ValidationPipe`/filter e valor original intacto no banco |
| A7 | SSE entrega e a reconexão não perde estado | `curl -N` no stream, confirmar um intake, derrubar e reabrir o stream, refazer `GET /api/submissoes` | Evento `submissao.updated` recebido; após reconexão o REST devolve o mesmo estado |
| A8 | 1 run ativo por vez | `POST /api/runs` duas vezes | Segundo retorna 409 com mensagem explicando (§10.21) |
| A9 | Receptor dormante grava sem interpretar | `POST /api/webhooks/fc` com JSON arbitrário | 202, linha em `webhook_payloads`, zero submissões criadas |
| A10 | Validação fecha os três desvios do §6 sem gastar agente (§10.1, §10.2, §10.3) | Confirmar um intake com quatro linhas: repo `file://` válido, repo inexistente, `repo_url` igual ao `base_repo_url` da skill e par (projeto, fase) fora do `skills_map` | `na_fila` com `commit_sha` pinado; `link_invalido` após 2 tentativas de `ls-remote`, com devolutiva de `correcao_id` nulo; `link_invalido` com `status_detalhe` "link do repositório base"; `sem_skill` com linha em `notificacoes` — e `docker ps -a` sem nenhum `fc-job-*` |
| A11 | Higiene do repo | `pnpm lint && pnpm typecheck && pnpm test` | Três verdes |

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

`packages/shared/src/intake/parse-blocos.test.ts` — é o teste de maior densidade da fase:

- bloco completo com todos os rótulos do §9.1 → todos os campos preenchidos
- `Fase:` e `Fase do projeto:` produzem o mesmo campo; `E-mail:` e `Email:` também
- três blocos colados em sequência → três resultados (nova ocorrência de `Projeto:` abre bloco)
- texto inteiro com `\r\n` → resultado idêntico ao de `\n`, sem `\r` residual em nenhum valor
- rótulos fora de ordem → mesmo resultado
- rótulo desconhecido (ex.: `Turma:`) → bloco íntegro e o rótulo em `desconhecidos[]`
- `Celular:` presente → objeto de saída não possui chave de celular (asserção sobre as chaves)
- sem `Repositório:` mas com URL no corpo → `repo_url` preenchido pelo fallback de regex, com a origem do valor marcada
- sem `Repositório:` e sem URL → `faltando` contém `repo_url`, sem exceção
- `Id:` ausente → `external_id` nulo; presente → preenchido
- valor contendo `:` (a própria URL) → só o primeiro `:` separa
- linhas em branco, espaços e tabs à esquerda do rótulo → tolerados; valores com espaço nas pontas → aparados
- texto vazio ou só espaços → lista vazia

Nos pacotes: e2e de intake (preview e confirmar, incluindo o caso do `Celular:`), e2e da validação da
submissão (os quatro desfechos do §6 a partir de `recebida`), unidade do wrapper de `git ls-remote`
(timeout, 2 tentativas com relógio injetado, argv separado sem shell), renderização do template de
`link_invalido` por motivo, e2e de SSE (tópico correto e heartbeat), e2e do webhook dormante, testes de
fronteira HTTP por recurso (código de resposta, contrato de erro, filtro que exclui), contrato de
serialização de `BigInt` (id vira string, sem `TypeError`), transições de `runs.status` pelas rotas de
ciclo de vida, imutabilidade de `texto_agente`, transições permitidas e proibidas por estado de origem,
vínculo de tentativa do §9.5, e recusa de transcript fora de `JOBS_DIR`. Nada de teste que reafirma
mock ou que verifica comportamento do framework.

## Riscos e armadilhas

- **Fixture de CRLF que se perde no caminho.** Se o `\r\n` do teste vier de arquivo, config de checkout ou formatter pode normalizá-lo e o teste vira falso-verde. Escreva as fixtures como string com `\r\n` explícito no próprio teste.
- **PII em fixture versionada.** Bloco real do admin traz nome e e-mail de aluno; anonimize antes de commitar (§11). Vale também para saída de teste em log.
- **Regra dura 6 depende de tipo, não de memória.** O celular só nunca persiste porque nenhum tipo tem o campo. Se alguém adicionar `celular` ao DTO, nenhum guard de `scripts/hooks/` pega — o `forbidNonWhitelisted` e o teste de chaves são a única defesa.
- **Validação de URL boa demais quebra a F7.** As fixtures E2E são bare repos locais clonados por `file://` (§14). Regra que aceite só `https://` reprova o próprio harness da F7.
- **`repo_url` é entrada de terceiro** (F5.7): `git ls-remote` montado como string de shell aceita argumento hostil (`--upload-pack=…` e afins) — `execFile` com argv separado, nunca `exec` (§11). E sem timeout ele prende a submissão em `validando`, estado que o §6 não tira de lá sozinho: 30 s por tentativa, testados com relógio injetado e não com `sleep`.
- **`Repositório:` com acento.** Se a comparação for literal e o bloco vier com acento mangled, o campo cai no fallback de regex e o erro passa despercebido — motivo da **D3**.
- **SSE atrás de compressão ou buffer** não entrega nada até fechar a conexão. Desligue compressão nesta rota e verifique com `curl -N`, não com cliente que bufferiza.
- **Node fora do PATH em shell não-interativo** (STATUS.md): script que suba a API por hook/cron precisa de caminho absoluto ou corepack no PATH.
- **Porta 5432 publicada no host** (STATUS.md): se houver Postgres local, a API sobe apontando para o banco errado. Confira `DATABASE_URL` antes de investigar bug fantasma.
- **Interface nova fora das três autorizadas** (CLAUDE.md) precisa de justificativa no commit — aqui só `OrigemDriver` e `EnvioDriver` são criadas.

## O que NÃO entra nesta fase

- Qualquer tela, componente ou store → F6
- Gatilhos programáticos, similaridade `pg_trgm`, agregação por (run, gatilho) e banner "3+ mesmo gatilho" → F7 (a F5 entrega a métrica `gatilhos por tipo`, que fica vazia até lá)
- Driver `fc_platform` (origem e envio), ativação do webhook e reconciliação por polling → F9
- Mecânica de fila, retry, timeout, pausa, cancelamento com kill/teardown, substituição e as transições de `submissoes.status`/`runs.status` → F4 (a F5 apenas as dispara e as expõe por HTTP)
- Validação do dossiê, prompt e retry corretivo → F3
- Login, deploy, socket proxy e métricas avançadas/exportação → F8
- Backup e runbook → F7

## Impacto em fases seguintes

A preencher no encerramento da fase.

| O que mudou aqui | Fase afetada | O que foi atualizado lá |
|---|---|---|

## Registro de execução

A preencher durante a fase.

- **Iniciada em:** AAAA-MM-DD
- **Concluída em:** AAAA-MM-DD
- **Decisões tomadas:** (D1–D8, com link para STATUS.md / Apêndice B quando arquitetural)
- **Divergências do plano:** (o que divergiu, por quê, e onde foi registrado)
- **Evidência dos aceites:** (saída de comando, resultado de teste)
