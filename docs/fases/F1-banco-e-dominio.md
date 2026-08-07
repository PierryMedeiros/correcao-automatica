# F1 — Banco e domínio

> **Status:** ⬜ não iniciada
> **Estimativa:** 1–2 dias úteis (plan §13)
> **Depende de:** F0 (fundação do monorepo)
> **Destrava:** F2 (onde a correção é persistida) · F3 (`skills_map` que o prompt lê) · F4 (estados e fila) · F5 (leitura da API)
> **Seções do plano:** §5 (modelo de dados) · §6 (estados) · §11 (retenção e PII) · §12 (limiares e `config`) · §10.1–2, §10.5, §10.9, §10.19–21, §10.24–25 · §17.1

## Objetivo

O sistema passa a ter um banco que conhece o domínio inteiro do §5: as nove tabelas, os enums do §6 e o
índice único parcial que torna duas submissões ativas do mesmo aluno no mesmo desafio impossíveis por
construção. `pnpm db:migrate` sobe tudo do zero e `pnpm db:seed` carrega os 49 pares desafio→skill do CSV
mais os defaults operacionais de `config`.

## Pré-condições

- [x] F0 marcada ✅ em `docs/fases/README.md` e no §13 do plano — ou, se o usuário antecipar a F1, decisão
      registrada em `docs/STATUS.md` (nada aqui depende de S1/S2/S3: a dependência é de ordem, não técnica)
- [x] `docs/skills-map.csv` completo (§17.1): `projeto`, `fase` e `modo_avaliacao` nas **48** linhas —
      **✅ fechado em 07/08/2026** com 46 blocos reais do admin (registro em `docs/skills-map-revisao.md`).
      São 48 e não 49 porque a `corrige-castmember-python` se declara variante legada e não tem desafio
      correspondente. Confira com um parser que respeite aspas — `awk -F,` erra as duas linhas com vírgula
      dentro do valor:
      `python3 -c "import csv;[print(r) for r in csv.DictReader(open('docs/skills-map.csv',encoding='utf-8')) if not(r['projeto'] and r['fase'] and r['modo_avaliacao'])]"`
- [x] §17.5 respondido: **NestJS+Prisma confirmado pelo usuário em 07/08/2026**. PrimeVue e o nome
      "Banca" seguem em aberto — só pesam na F6 e não bloqueiam esta fase
- [x] Postgres de dev de pé: `docker compose up -d && docker compose ps` mostra `banca-dev-db-1` healthy
- [x] `.env` existe (cópia de `.env.example`) com `DATABASE_URL` preenchida
- [x] Base da F0 verde: `pnpm lint`, `pnpm test`, `pnpm typecheck`, `pnpm guards`; `node -v` = 24.x no shell
      da sessão (nvm não carrega em shell não-interativo — ver "Riscos")

## Decisões do plano que esta fase materializa

| Decisão | Onde está | Consequência prática nesta fase |
|---|---|---|
| "Ativo" definido por complemento dos terminais, não por lista | §5, Apêndice B v1.3 item 1 | O predicado do índice parcial é `NOT IN ('enviada','cancelada','substituida')` (F1.4); `link_invalido`, `sem_skill` e `erro` são ativos, e o reenvio substitui a submissão travada |
| `devolutivas.correcao_id` é nullable | §5, Apêndice B v1.3 item 2 | Devolutiva de `link_invalido` nasce sem correção (F1.3) |
| `skills_map` é a fonte da verdade do `modo_avaliacao` | §5, §17.6, Apêndice B v1.3 item 7 | Coluna NOT NULL e campo obrigatório no seed, sem heurística de fallback |
| Limiares de tamanho da devolutiva são globais | §12, §10.25, Apêndice B v1.3 item 4 | `skills_map` **não** ganha coluna de limiar; os valores entram em `config` (F1.7) |
| Retenção de job dirs em duas classes (órfão × referenciado 14d) | §11, Apêndice B v1.3 item 3 | `correcoes.transcript_path` é o que torna um job dir "referenciado"; o prazo vira chave em `config` |
| Duração anômala: p95 só com n ≥ 10, senão 80% do timeout | §12, Apêndice B v1.3 item 5 | Nenhuma coluna nova: `correcoes.duracao_s` + `skills_map.timeout_s` bastam; a estatística é query da F7 |
| Celular do aluno nunca persiste | §5, §11, regra dura 6 | Nenhuma tabela tem coluna de telefone — e um teste garante que não passa a ter |
| `texto_agente` imutável, edição em `texto_final` | §5, regra dura 7 | Duas colunas distintas desde a primeira migration |
| Estados são exatamente os 12 do §6 | §6, regra dura 3 | Enum nativo do Postgres, completo já aqui — inclusive `nao_executada` e `inconclusivo` (§10.8, §10.10), cuja lógica é da F4; estado novo = plano primeiro, migration depois |
| ids `bigint` que não vazam para o aluno | §5 | `BigInt @id @default(autoincrement())` em todas as tabelas |

## Decisões a tomar nesta fase

> ✅ **As dez foram decididas com o usuário em 07/08/2026, todas conforme a recomendação.** A coluna
> da direita deixou de ser sugestão e passou a ser a decisão. Reabrir qualquer uma exige registrar o
> motivo aqui e no `docs/STATUS.md` — não decidir de novo em silêncio no meio da implementação.
>
> As três que o usuário quis discutir, e o que pesou: **D1** (Prisma em `apps/api/prisma/` — a API é o
> único consumidor, `packages/db` seria cerimônia), **D4** (enums em `packages/shared` — o front não
> pode depender do client Prisma) e **D8** (índice parcial em vez de regra de aplicação — §2.4:
> colisão vira impossível, não proibida).

| # | Pergunta | Opções | **Decisão (07/08/2026)** |
|---|---|---|---|
| D1 | Onde moram `schema.prisma`, migrations e client | `apps/api/prisma/` · `packages/db` · `prisma/` na raiz | `apps/api/prisma/` — a API é o único consumidor no MVP; pacote extra é cerimônia (CLAUDE.md, YAGNI) |
| D2 | Se D1 = `apps/api`, o pacote nasce sem Nest — com o quê? | só `prisma/` + client + seed · bootstrap Nest já agora · `packages/db` para evitar a questão | Só `prisma/` + client + seed. Não é shell vazio (a F1 o preenche), então não colide com a decisão de 07/08 no STATUS nem com a regra dura 8; o bootstrap do Nest é a F4.0 |
| D3 | Onde rodam os testes de acesso a dados | banco `banca` com truncate · database `banca_test` no mesmo Postgres, migrado pelo harness | `banca_test` — teste nunca toca dado de dev; `DATABASE_URL_TEST` no `.env.example` |
| D4 | Quem é o dono dos enums de domínio | `packages/shared`, com o schema Prisma replicando · `@prisma/client`, com o shared re-exportando | `packages/shared` — o front não pode depender do client Prisma; divergência travada por teste (F1.3) |
| D5 | Tipo do valor em `config` | `text` · `jsonb` | `jsonb` — a tabela guarda número, booleano e texto longo; evita parse por chave |
| D6 | Seed com linha inválida: pula ou aborta? | pula a linha e sai ≠ 0 · valida tudo antes, não escreve nada e sai ≠ 0 listando todas | Abortar antes de escrever — "falhar alto aqui é barato" (§13 F1); `skills_map` meio carregado vira `sem_skill` silencioso na fila |
| D7 | Linha que sumiu do CSV mas existe no banco | ignorar · marcar `ativo = false` · deletar | `ativo = false` — a coluna existe para isso (§5); deletar quebraria FK de submissões antigas |
| D8 | "1 run ativo por vez" (§10.21) é constraint ou regra de aplicação? | só aplicação (F4/F6) · índice único parcial em `runs WHERE status = 'ativo'` | Índice parcial — §2.4: colisão vira impossível, não proibida, ao custo de uma linha de SQL |
| D9 | `eventos.submissao_id` pode ser nulo? | NOT NULL · nullable | Nullable — pausa global e ações de run são eventos sem submissão (§9.3, §12) |
| D10 | Unicidade de submissão ativa é sensível a caixa no e-mail? | coluna crua · `lower(aluno_email)` | `lower(aluno_email)` — o e-mail vem colado do admin (§9.1); `Aluno@x.com` abrindo segunda submissão ativa fura o §10.5 em silêncio |

## Etapas

Os caminhos abaixo assumem **D1 = `apps/api/prisma/`**; decisão diferente = ajustar caminhos e registrar aqui e no `docs/STATUS.md` antes de escrever código.

### F1.1 — Tipos de domínio em `packages/shared`

**Entrega:** o vocabulário do §5/§6 existe em TypeScript, com "ativo" calculado por complemento.

**Arquivos:** `packages/shared/package.json`, `packages/shared/src/index.ts`,
`packages/shared/src/dominio/enums.ts`, `packages/shared/src/dominio/estados.ts`,
`packages/shared/src/dominio/estados.test.ts`

**Tarefas**

- [ ] Criar o pacote `@banca/shared` (privado, ESM, estendendo `tsconfig.base.json`) no workspace
- [ ] Declarar como `const` + tipo derivado os enums do §5: `OrigemSubmissao`, `StatusSubmissao` (os 12
      estados do §6), `StatusCorrecao`, `Veredito`, `ModoAvaliacao`, `PoliticaRevisao`, `StatusRun`
- [ ] Declarar `STATUS_TERMINAIS = ['enviada','cancelada','substituida']` e
      `estaAtiva(status) = !STATUS_TERMINAIS.includes(status)` — o complemento do §5 vira **uma** função,
      nunca uma segunda lista; comentar o porquê (Apêndice B v1.3 item 1)
- [ ] Registrar no topo de `estados.ts` que a F1 é a **fase titular** de `StatusSubmissao`,
      `STATUS_TERMINAIS` e `estaAtiva`: fase seguinte que precisar da regra **acrescenta** a este arquivo
      (a F4 traz para cá a tabela de transições do §6 e `podeTransicionar()`) — nunca redeclara o enum em
      outro caminho nem cria segunda função de complemento com outro nome. Dois caminhos para a mesma regra
      é a duplicação que o CLAUDE.md proíbe ("`packages/shared` é o dono dos tipos; nunca duplicar tipos")
- [ ] Exportar tudo por `src/index.ts`; nenhum tipo de domínio duplicado fora daqui (CLAUDE.md)

**Testes:** `estados.test.ts` — a lista tem 12 estados; os três terminais dão `false` em `estaAtiva`;
`link_invalido`, `sem_skill` e `erro` dão `true` (a consequência assumida no §5).

**Pronto quando:** `pnpm typecheck` e `pnpm test` verdes com o pacote no workspace.

### F1.2 — Prisma de pé com a primeira tabela (`skills_map`)

**Entrega:** `pnpm db:migrate` cria o banco do zero e os testes de acesso a dados já rodam contra ele.

**Arquivos:** `apps/api/package.json`, `apps/api/prisma/schema.prisma`,
`apps/api/prisma/migrations/*/migration.sql`, `apps/api/tests/setup-db.ts`, `vitest.config.ts`,
`package.json` (raiz), `.env.example`

**Tarefas**

- [ ] Criar `apps/api` como pacote de dados (D2): `prisma` + `@prisma/client`, sem Nest
- [ ] `schema.prisma` com datasource Postgres lendo `DATABASE_URL` e generator do client
- [ ] Modelar `skills_map` (§5): `projeto`, `fase`, `skill_slug`, `modo_avaliacao` (enum), `base_repo_url`
      null, `timeout_s` null, `ativo` default `true`, timestamps, `@@unique([projeto, fase])`
- [ ] Gerar a migration com `prisma migrate dev --create-only` e aplicar com `prisma migrate deploy` —
      nunca `db push`, nunca SQL fora de migration (regra dura 4)
- [ ] Adicionar `db:migrate` e `db:seed` ao `package.json` da raiz, delegando para `apps/api`
- [ ] Criar o harness de teste (D3): `DATABASE_URL_TEST` em `.env.example`, setup do vitest que aplica as
      migrations em `banca_test` e limpa as tabelas entre arquivos; registrar no `include` do vitest

**Testes:** `skills_map` — par `(projeto, fase)` repetido viola a unicidade; `ativo` nasce `true`;
`base_repo_url` e `timeout_s` aceitam nulo.

**Pronto quando:** com `banca_test` derrubado, `pnpm db:migrate` + `pnpm test` passam sem passo manual.

### F1.3 — Núcleo do domínio: `runs`, `submissoes`, `correcoes`, `devolutivas`

**Entrega:** o ciclo de vida inteiro de uma entrega tem onde ser persistido.

**Arquivos:** `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/*/migration.sql`,
`apps/api/tests/db/schema.test.ts`

**Tarefas**

- [ ] `runs` (§5): `modelo`, `max_paralelo` default 2, `politica_revisao` (enum), `status` (enum)
- [ ] `submissoes` (§5): `origem` (enum), `external_id` null, `run_id` FK null, `aluno_nome`,
      `aluno_email`, `projeto`, `fase`, `skill_slug` null, `repo_url`, `commit_sha` null, `attempt_aluno`
      default 1, `anterior_id` FK auto-referente null, `status` (enum §6), `status_detalhe` null — e
      **nenhuma** coluna de celular/telefone (regra dura 6, §11)
- [ ] `correcoes` (§5): `submissao_id` FK, `retry_n`, `status` (enum), `veredito` (enum, null), `dossie`
      jsonb null, `gatilhos` `text[]`, `modelo`, `duracao_s`, `started_at`, `finished_at`,
      `transcript_path`, `exit_code` null, `erro_resumo` null
- [ ] `devolutivas` (§5): `submissao_id` FK, `correcao_id` FK **nullable** (Apêndice B v1.3 item 2),
      `texto_agente`, `texto_final`, `veredito_final` (enum), `enviada_em` null, `enviada_por` null
- [ ] Declarar os enums do Postgres com exatamente os valores do §5/§6 — 12 estados, nem um a mais (regra dura 3)
- [ ] Nenhuma constraint de imutabilidade para `texto_agente`: a regra dura 7 é da aplicação (F5)
- [ ] Indexar o que fila e histórico consultam: `submissoes(status)`, `correcoes(submissao_id)`,
      `devolutivas(submissao_id)`

**Testes:** `schema.test.ts` — cada enum do Postgres tem exatamente os valores de `packages/shared` (trava
D4); `devolutivas` aceita `correcao_id` nulo; nenhuma coluna de `submissoes` contém `celular`/`telefone`
(consulta a `information_schema.columns`).

**Pronto quando:** a migration aplica do zero e `schema.test.ts` passa.

### F1.4 — Índice único parcial de submissão ativa

**Entrega:** duas submissões ativas do mesmo aluno para o mesmo desafio deixam de ser possíveis.

**Arquivos:** `apps/api/prisma/migrations/*/migration.sql`, `apps/api/tests/db/submissao-ativa.test.ts`

**Tarefas**

- [ ] Criar o índice em SQL cru dentro da migration — o Prisma não expressa `WHERE` em `@@unique`, então a
      migration nasce com `--create-only` e é editada antes de aplicar
- [ ] Escrever o predicado por **complemento**: `WHERE status NOT IN ('enviada','cancelada','substituida')`.
      **Nunca** listar os estados ativos (§5 + Apêndice B v1.3 item 1) — assim estado novo entra como ativo
      automaticamente e as duas listas não têm como divergir
- [ ] Indexar `(lower(aluno_email), projeto, fase)` (D10)
- [ ] Comentar na migration a consequência assumida: `link_invalido`, `sem_skill` e `erro` são ativos, logo
      o reenvio com o link corrigido **substitui** a submissão travada, sem criar segunda linha (§5, §10.5)
- [ ] Criar também o índice único parcial de `runs` em `status = 'ativo'` se D8 for aceita (§10.21), e
      registrar em comentário que a lista de terminais em TypeScript é `STATUS_TERMINAIS` (F1.1)

**Testes:** `submissao-ativa.test.ts` — matriz sobre **todos** os 12 estados: em cada estado ativo, a
segunda submissão do mesmo `(aluno_email, projeto, fase)` viola a unicidade; nos três terminais, passa;
mesmo aluno em `(projeto, fase)` diferente sempre passa (§10.20); e-mail com caixa diferente colide (D10).
Estado novo sem revisão do índice quebra este teste.

**Pronto quando:** a matriz passa inteira e `\d submissoes` mostra o índice com o predicado `NOT IN`.

### F1.5 — Tabelas de apoio: `eventos`, `notificacoes`, `webhook_payloads`, `config`

**Entrega:** auditoria, notificação, captura de webhook e configuração têm tabela.

**Arquivos:** `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/*/migration.sql`,
`apps/api/tests/db/apoio.test.ts`

**Tarefas**

- [ ] `eventos` (§5, §12): `submissao_id` FK **nullable** (D9), `tipo`, `payload` jsonb, `ts` default
      `now()`; append-only por convenção — sem update nem delete no código da aplicação
- [ ] `notificacoes` (§5): `tipo`, `texto`, `lida` default `false`, `link` null
- [ ] `webhook_payloads` (§5, §3): `headers` jsonb, `body` bruto, `ts` — nasce vazia e dormente; quem a
      preenche é o receptor, fora desta fase
- [ ] `config` (§5): `chave` PK text, `valor` jsonb (D5), `descricao` text, `updated_at`
- [ ] Indexar `eventos(submissao_id, ts)` — é a query da timeline do card (§9.3)

**Testes:** `apoio.test.ts` — `eventos` aceita `submissao_id` nulo; `config` recusa chave duplicada;
`notificacoes.lida` nasce `false`.

**Pronto quando:** as nove tabelas do §5 existem no banco criado do zero.

### F1.6 — Seed do `skills_map` a partir do CSV

**Entrega:** `pnpm db:seed` carrega os 49 pares desafio→skill ou recusa o arquivo dizendo onde está o erro.

**Arquivos:** `apps/api/prisma/seed/skills-map.ts`, `apps/api/prisma/seed/csv.ts`,
`apps/api/tests/db/seed-skills-map.test.ts`, `apps/api/tests/fixtures/*.csv`

**Tarefas**

- [ ] Ler `docs/skills-map.csv` exigindo o cabeçalho exato
      `projeto,fase,skill_slug,modo_avaliacao,base_repo_url,timeout_s` — mesmo contrato já travado por
      `tests/skills-map.test.ts` (F0), que segue valendo: o seed respeita esse teste, não o substitui
- [ ] Normalizar BOM e CRLF antes de dividir as linhas (o CSV é editado à mão, possivelmente no Windows)
- [ ] **Parsear conforme RFC 4180, nunca com `split(',')`**: nome de desafio na plataforma contém vírgula
      (`Do compose ao cluster: Docker, Kubernetes e Terraform`), e o casamento com o bloco colado é
      literal — trocar a vírgula por outro caractere garantiria que o par nunca casa. Valor com vírgula
      vai entre aspas e aspas internas são dobradas; `tests/skills-map.test.ts` (F0) já traz o parser e o
      teste de aspas desbalanceadas, e o seed tem que ler igual
- [ ] Recusar linha com número de colunas ≠ 6, reportando o número da linha
- [ ] Recusar a **linha inteira** quando `projeto`, `fase`, `skill_slug` ou `modo_avaliacao` vier vazio, com
      o número da linha (contando o cabeçalho, como no teste da F0) e o nome do campo faltante (§13 F1);
      `base_repo_url` e `timeout_s` são opcionais por §5
- [ ] Recusar `modo_avaliacao` fora de `{execucao, estatica}` e `skill_slug` sem prefixo `corrige-`
- [ ] Validar o arquivo inteiro antes de escrever qualquer linha; havendo recusa, sair com código ≠ 0
      listando **todos** os problemas e sem tocar no banco (D6)
- [ ] Upsert por `(projeto, fase)` — rodar duas vezes não duplica nem zera `ativo`
- [ ] Marcar `ativo = false` no que sumiu do CSV; nunca deletar (D7). Imprimir sumário final: inseridas,
      atualizadas, desativadas

**Testes:** `seed-skills-map.test.ts` com fixtures pequenas — CSV válido carrega N linhas; linha sem `fase`
é recusada com a mensagem apontando linha e campo; linha com 5 colunas e modo fora do enum são recusados;
**valor entre aspas com vírgula dentro chega ao banco com a vírgula**; aspas desbalanceadas são recusadas;
**nada é escrito** quando há recusa; segunda execução é idempotente; linha removida vira `ativo = false`.

**Pronto quando:** `pnpm db:seed` com o CSV real carrega as linhas do arquivo e, com uma linha mutilada,
sai ≠ 0 sem escrever nada. O CSV tem **48** linhas, não 49: a `corrige-castmember-python` se declara
"variante genérica/legada" no próprio `SKILL.md` e não corresponde a desafio da plataforma, então não tem
par para mapear (registro em `docs/skills-map-revisao.md`).

### F1.7 — `pg_trgm` e defaults de `config`

**Entrega:** o banco tem a extensão de similaridade e os limiares operacionais que F2, F4 e F7 vão ler.

**Arquivos:** `apps/api/prisma/migrations/*/migration.sql`, `apps/api/prisma/seed/config.ts`,
`apps/api/tests/db/config-defaults.test.ts`

**Tarefas**

- [ ] `CREATE EXTENSION IF NOT EXISTS pg_trgm;` dentro de uma migration Prisma (regra dura 4)
- [ ] Semear `config` com os defaults do plano, cada chave com `descricao` apontando a seção de origem:
      `pausa_global` como **objeto** `{ "ativa": false, "motivo": null, "desde": null, "tentativas": 0 }`
      (§12) — nunca booleano, porque a pausa automática precisa registrar por quê e desde quando; a
      `descricao` documenta `motivo ∈ {manual, limite_plano, credencial, disco}` (§12, §10.10, §10.11,
      §10.19) e `tentativas` como contador de retomada escalonada (§10.10);
      `devolutiva_link_invalido_template` (§6, §10.1–2), com marcador para o
      motivo (privado, inexistente, link do template); `gatilho_tamanho_aprovado_frases` = 5,
      `gatilho_tamanho_aprovado_caracteres` = 700, `gatilho_tamanho_reprovado_frases` = 20 (§10.25, §12);
      `gatilho_similaridade_limiar` = 0.6 (§12); `disco_alerta_gb` = 15, `disco_pausa_gb` = 5 (§10.19);
      `retencao_job_dir_dias` = 14 (§11); `retencao_backup_dias` = 14 (§12);
      `gatilho_duracao_min_amostras` = 10 e `gatilho_duracao_fracao_timeout` = 0.8 (§12: p95 só com
      n ≥ 10, senão 80% do timeout efetivo); `gatilho_agregacao_min_ocorrencias` = 3 (§10.27);
      `retomada_intervalos_min` = [5, 15, 30, 60] (§10.10: retomada escalonada após pausa automática) — os quatro
      são lidos pela F7, e nascem aqui para que calibrar seja mudar linha, não recompilar
- [ ] Semear `timeout_job_padrao_s` = 1500 (§5, §10.9): o plano fixa o valor mas não diz onde ele mora, e
      `config` é o único lugar que existe — registrar a escolha no `docs/STATUS.md`. A chave é o **único**
      lugar onde 1500 aparece: o timeout efetivo é sempre
      `skills_map.timeout_s ?? config.timeout_job_padrao_s`, e nenhuma fase fixa o literal `1500` no código
      (Job Controller da F2, timeout da F4, gatilho de duração anômala da F7 leem daqui)
- [ ] Seed de `config` idempotente e **não destrutivo**: chave existente não é sobrescrita (valor calibrado
      na F7 não pode ser revertido por um `db:seed`); mesmo `pnpm db:seed` roda `config` e `skills_map`

**Testes:** `config-defaults.test.ts` — todas as chaves acima existem com os valores do plano; `pausa_global`
é objeto com `ativa = false` e as quatro chaves (nunca booleano); `timeout_job_padrao_s` = 1500; reseed após
alterar um valor não o sobrescreve; `SELECT similarity('abc','abd')` responde.

**Pronto quando:** banco do zero + `pnpm db:migrate` + `pnpm db:seed` deixa `skills_map` e `config` prontos,
e `pg_trgm` aparece em `pg_extension`.

## Edge cases do §10 cobertos aqui

| # | Caso | Como esta fase trata | Onde é verificado |
|---|---|---|---|
| 2 | Aluno colou o link do repo base | `skills_map.base_repo_url` existe para a comparação (a detecção é F5) | F1.2 |
| 3 | (projeto, fase) sem skill | `sem_skill` no enum de estados; `skills_map.ativo` desativa par sem excluir | F1.1, F1.3 |
| 5 | Nova entrega com a anterior ativa | O índice único parcial é o mecanismo de dedupe (a transição é F4) | Aceite A3 |
| 9 | Timeout por skill | As duas pontas da fórmula única `skills_map.timeout_s ?? config.timeout_job_padrao_s`; o literal 1500 mora só no seed | F1.2, F1.7 |
| 19 | Disco enchendo | `disco_alerta_gb` = 15 e `disco_pausa_gb` = 5 em `config` | Aceite A6 |
| 20 | Mesmo aluno, 2 desafios ao mesmo tempo | O índice inclui `(projeto, fase)`, então não bloqueia | Aceite A3 |
| 21 | 2º run com um ativo | Índice único parcial em `runs WHERE status = 'ativo'` (D8) | Aceite A3 |
| 24 | Devolutiva quase idêntica à de outro aluno | `pg_trgm` instalada e limiar 0.6 semeado (o gatilho é F7) | Aceite A2, A6 |
| 25 | Devolutiva longa demais | Limiares globais em `config`, não em `skills_map` (Apêndice B v1.3 item 4) | Aceite A6 |

## Critérios de aceite

**Esta seção é a fonte da verdade do "pronto" desta fase** (o §13 do plano aponta para cá).

| # | Critério | Como provar | Evidência esperada |
|---|---|---|---|
| A1 | Migrations sobem do zero | Dropar `banca_test` e rodar `pnpm db:migrate` | Sem erro; `\dt` lista as 9 tabelas do §5 |
| A2 | `pg_trgm` instalada por migration | `SELECT extname FROM pg_extension WHERE extname='pg_trgm'` | 1 linha; `similarity('abc','abd')` retorna número |
| A3 | O índice parcial obedece à definição de ativo por complemento | `pnpm test` (`submissao-ativa.test.ts`) | Matriz dos 12 estados verde: só os 3 terminais permitem segunda linha |
| A4 | Seed carrega o CSV completo e é idempotente | `pnpm db:seed` duas vezes | 49 linhas em `skills_map`; a segunda execução não duplica |
| A5 | CSV com linha incompleta é recusado apontando linha e campo | `pnpm db:seed` com fixture sem `fase` na linha 7 | Exit ≠ 0, mensagem com "linha 7" e o campo `fase`; `skills_map` intocado |
| A6 | `config` nasce com os defaults do §11/§12/§10 | `SELECT chave, valor FROM config ORDER BY chave` | Todas as chaves de F1.7 com os valores do plano; `pausa_global` como objeto `{ativa:false, motivo:null, desde:null, tentativas:0}` e `timeout_job_padrao_s` = 1500 |
| A7 | Enums do banco e tipos de `packages/shared` não divergem | `pnpm test` (`schema.test.ts`) | Verde |
| A8 | Nenhuma coluna de PII proibida existe | `pnpm test` (`schema.test.ts`) | Nenhuma coluna de celular/telefone em `submissoes` |
| A9 | Qualidade da base mantida | `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm guards` | Tudo verde |

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

- `packages/shared/src/dominio/estados.test.ts` — 12 estados do §6 e a classificação por complemento; é a
  suite do módulo titular, que as fases seguintes ampliam (F4: transições) em vez de recriar em outro arquivo.
- `apps/api/tests/db/schema.test.ts` — enums do Postgres × shared; `correcao_id` nullable; sem coluna de celular.
- `apps/api/tests/db/submissao-ativa.test.ts` — matriz de unicidade por estado, dois desafios do mesmo aluno, caixa do e-mail.
- `apps/api/tests/db/seed-skills-map.test.ts` — campo faltante com linha e nome, coluna faltando, modo fora do enum, cabeçalho errado, idempotência, desativação.
- `apps/api/tests/db/config-defaults.test.ts` — chaves e valores default, formato de objeto de
  `pausa_global` e `timeout_job_padrao_s` = 1500; reseed não sobrescreve.
- `apps/api/tests/db/apoio.test.ts` — `eventos.submissao_id` nulo, unicidade de `config.chave`.
- `apps/api/tests/setup-db.ts` — harness: migra `banca_test` e limpa entre arquivos.
- `tests/skills-map.test.ts` (F0) — segue valendo como contrato do CSV que o seed respeita.

## Riscos e armadilhas

- **Prisma não expressa índice parcial.** Os índices de F1.4 só existem porque a migration foi editada após
  `--create-only`. Alerta: regenerar a migration ou usar `prisma db push` e o A3 passar a aceitar duas ativas.
- **`prisma migrate dev` propõe reset ao detectar drift.** Nunca rodar contra o banco `banca` com dados; o
  fluxo desta fase é `--create-only` + `migrate deploy`.
- **`pnpm test` passa a exigir Postgres de pé.** Falhar com mensagem acionável, não pular o teste em
  silêncio — teste pulado é teste que não existe.
- **Testes de banco em paralelo se atropelam.** Ou o harness serializa os arquivos de banco, ou cada um usa
  dados próprios. Sinal: falha intermitente na unicidade.
- **`BigInt` no TypeScript**: `JSON.stringify` de `BigInt` lança `TypeError` — não dói aqui, dói na primeira
  resposta REST (F5); anotar em "Impacto em fases seguintes" ao encerrar.
- **Enum nativo do Postgres é caro de alterar** (remover valor exige recriar o tipo). É recurso, não defeito:
  mudar estado exige plano primeiro (regra dura 3).
- **Node fora do PATH em shell não-interativo** (STATUS): seed chamado por hook, cron ou `execFile` precisa
  de caminho absoluto. E a porta 5432 já publicada quebra o `up` de quem tem Postgres local.
- **CSV editado no Excel** vira CRLF, BOM e campos entre aspas: o seed normaliza os dois primeiros e recusa
  o resto com mensagem clara, em vez de adivinhar.

## O que NÃO entra nesta fase

- Transições de estado, `retry_n`, pausa global, cancelamento, substituição e pg-boss → F4 (a F1 entrega os
  enums e o índice; a lógica que os movimenta é lá). A tabela de transições do §6 e `podeTransicionar()`
  entram **dentro** de `packages/shared/src/dominio/estados.ts`, criado aqui — a F4 amplia o módulo,
  reusando `StatusSubmissao` e `estaAtiva`, sem redeclarar enum nem duplicar a regra de "ativo"
- Controllers, DTOs, módulos Nest, REST e SSE → F5 (o `apps/api` desta fase é só camada de dados)
- Parser de bloco do intake e serialização de `BigInt` no HTTP → F5 · `dossie.schema.json` e validador → F3
- Gatilhos programáticos e índice GIN trigram sobre devolutivas → F7 (a extensão entra agora; o índice
  depende da query, que só existe lá)
- Retenção efetiva de job dirs, com a F1 entregando só as chaves em `config` → F2 (janitor)
- Seed de dados de demonstração → fase nenhuma: quem precisa de dado o cria no próprio teste
- Qualquer tela → F6

## Impacto em fases seguintes

A preencher no encerramento da fase.

| O que mudou aqui | Fase afetada | O que foi atualizado lá |
|---|---|---|

## Registro de execução

A preencher durante a fase.

- **Iniciada em:** AAAA-MM-DD
- **Concluída em:** AAAA-MM-DD
- **Decisões tomadas:** (D1–D10 acima; as de arquitetura vão também para o Apêndice B do plano)
- **Divergências do plano:** (o que divergiu, por quê, e onde foi registrado)
- **Evidência dos aceites:** (saída de comando, resultado de teste)
