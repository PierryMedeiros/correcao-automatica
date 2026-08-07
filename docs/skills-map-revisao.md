# Revisão do `skills-map.csv` — progresso e achados

Atualizado em 07/08/2026, após 21 blocos reais do admin da FC.

| Coluna | Estado |
|---|---|
| `skill_slug` | 49/49 |
| `modo_avaliacao` | 49/49 (38 `execucao` · 11 `estatica`) — lido dos `SKILL.md` |
| `base_repo_url` | 10/49 — só as que a skill cita literalmente |
| `timeout_s` | 9/49 — desafios pesados, 2700s conservador |
| **`projeto` + `fase`** | ✅ **48/48 confirmados por bloco real do admin** |

`grep REVISAR docs/skills-map.csv` volta vazio — a pendência §17.1 está fechada e o seed da F1 tem
arquivo completo para carregar.

---

## O que os blocos reais ensinaram

O bloco do admin tem esta forma (rótulos exatos):

```
Interações da Entrega
Projeto: Desafios MBA Arquitetura
Fase do projeto: DDD - Lista de Espera de Ingressos
Criado em : 05/08/2026 10:07:13
Repositório: https://github.com/aluno/repo
Aluno: Nome do Aluno
```

**`Projeto:` não é o curso.** É um agrupamento de desafios, e o estilo varia: às vezes é o programa
(`Desafios MBA IA`), às vezes o módulo (`Administração do Catálogo de vídeo com Python`), às vezes um
único desafio (`Desafio Leilão`). O curso (FC 3.0, FC 4.0, Pós, MBA) **não aparece**. Por isso não
adianta tentar deduzir: o valor só sai de olhar o admin.

### Valores de `projeto` já confirmados

Servem para os desafios irmãos que ainda faltam:

| `projeto` | Confirmado por |
|---|---|
| `Desafios MBA Arquitetura` | hexagonal · DDD lista de espera · docker-k8s-terraform · fechamento de faturamento |
| `Desafios MBA IA` | prompt-langchain · langchain-postgres · design-docs · skills-refactor · streamtube |
| `Administração do Catálogo de vídeo com Python` | 7 desafios do Codeflix Python |
| `Desafio prático - Docker` | do dev à produção (API Node.js) |
| `TDD - Test Driven Development` | desafio de TDD |
| `Desafio Leilão` | leilão com goroutines |
| `Desafio Observabilidade & Open Telemetry` | tracing distribuído |

---

## Quatro achados dos blocos reais

### 1. ✅ Resolvido — vírgula no valor, com aspas RFC 4180

Dois desafios têm vírgula no nome:

- `Do compose ao cluster: Docker, Kubernetes e Terraform`
- `Pull, Otimização e Avaliação de Prompts com LangChain/Smith`

Não dava para "limpar" a vírgula: o casamento é literal contra o texto colado, então trocar por ponto e
vírgula garantiria que o par nunca casa. Mudou o formato do arquivo, não o dado.

**Feito:** valor com vírgula vai entre aspas (aspas internas dobradas), `tests/skills-map.test.ts`
ganhou um parser RFC 4180 no lugar do `split(',')` mais teste de aspas desbalanceadas, e a F1.6 herdou
a exigência de o seed ler igual.

**Ao editar:** no Excel ou Google Sheets as aspas são automáticas — é só digitar o nome com vírgula. Em
editor de texto, envolva o valor em aspas à mão.

Isso vale só para **este arquivo**. O que vem da plataforma — colado ou por API — é string comum em
coluna `text` do Postgres: a vírgula viaja inteira e não existe delimitador para atrapalhar.

### 2. ✅ Resolvido — o bloco traz e-mail

Captura de tela de 07/08/2026 mostrou duas linhas a mais do que vinha nos textos colados: `E-mail:` e
`Celular:`, logo depois de `Aluno:`. Os textos chegaram cortados por seleção parcial na cópia, não por
campo ausente.

O §5 segue seguro — `(aluno_email, projeto, fase)` tem chave e nada muda no plano. E `Celular:` existe
mesmo, então a regra dura 6 (reconhecer e descartar, nunca persistir) tem alvo real.

### 3. ✅ O nome do desafio é truncado em 60 caracteres — confirmado

`Fechamento de Faturamento: do cálculo descartável à persistê` vem cortado no meio da palavra. O mesmo
bloco foi colado duas vezes e veio idêntico: **é assim na origem**, não perda na cópia.

Medido: o valor truncado tem **exatamente 60** caracteres; os outros 18 confirmados têm **≤ 57**; e
`Pull, Otimização e Avaliação de Prompts com LangChain/Smith` (59) usa `LangChain/Smith` no lugar de
`LangChain e LangSmith`, que daria 63 — encurtado à mão para caber.

Como o truncamento é estável, o casamento literal funciona e o valor foi gravado como vem. O risco
sobrevivente é outra superfície (a API da F9, um export) devolver o nome **completo**: aí o mesmo
desafio teria duas chaves. Registrado em `INTEGRATION.md` (O2 e pergunta 5).

### 4. 🔴 O campo `Repositório:` quase nunca vem limpo — e a subpasta importa

Em 46 blocos, cerca de **1 em 3** precisa de tratamento:

```
.../pos-stress-test/tree/main                              branch
.../codeflix-catalog-admin/tree/modulo-6-django-api-parte-2  branch
.../Desafio-Fullcycle-Docker/tree/master/node              branch + subpasta
.../Desafio-Fullcycle-Docker/tree/master/go                branch + subpasta
.../curso-full-cycle/tree/main/13-event-driven-architecture  branch + subpasta
.../fc-monolito.git                                        sufixo .git
.../order_repository_full_cycle_test#                      # solto no fim
.../desafio-ci-fc/pull/7                                   pull request
https://l01-635482334530.southamerica-east1.run.app/?cep=...  nem é repositório
```

**A única ação necessária é normalizar a URL para o clone.** Nem branch nem subpasta mudam o que é
avaliado:

- **A branch não muda nada** porque o §9.2 pina o `commit_sha` no intake e o prompt v2 (Apêndice A)
  proíbe `fetch` e troca de ref — decisão que já estava no plano. E as skills exigem o código na
  `main` ("Branch Principal: todo o código deve estar na branch main", enunciado do desafio de EDA).
  Aluno que aponta para outra branch está violando regra de entrega, e quem julga isso é a skill com o
  agente.
- **A subpasta também não**, porque o agente clona o repo inteiro e navega sozinho.

O que sobra é mecânico e acontece **antes de existir agente**: `git ls-remote` (§9.2 passo 1) e
`git clone` (passo 4) rodam no intake e no entrypoint, e o §10.1 manda template "sem agente" quando
falham. Como `github.com/dono/repo/tree/main` é repositório público perfeitamente acessível — é só a
URL da barra de endereço —, reprovar por "repositório inacessível" seria devolutiva errada, que é o que
o §1 existe para evitar.

Guardar `<ref>` e `<subpasta>` como observação no job é opcional: serve ao revisor humano, não ao
roteamento.

> **Correção de 07/08/2026.** A versão anterior desta seção dizia que descartar a subpasta faria a
> correção avaliar o código errado, e que o `<ref>` deveria virar candidato a checkout. As duas coisas
> estavam erradas, e a segunda contrariava o §9.2 e o Apêndice A. Apontado pelo Pierry.

**Dois casos não são repositório:** o PR (`/pull/7`) é entrega legítima do desafio de CI, e a
validação tem que aceitá-la; a URL do Cloud Run é entrega errada do aluno, e merece devolutiva
específica em vez do template genérico de "repositório inacessível".

Registrado em `INTEGRATION.md` (O4, O4b, O4c).

---

## As 30 skills que ainda precisam de bloco

Agrupadas pelo que parecem ser, para ajudar a localizar no admin:

**Go (8)** — `client-server-api` · `multithreading-cep` · `rate-limiter` · `stress-test-go` ·
`temperatura-cep` · `clean-architecture-go` · `docker-go-otimizado` · `eda-balances-kafka`

**Codeflix TypeScript (5)** — `codeflix-ts-entidade-categoria` ·
`codeflix-ts-repositorio-validacao-categoria` · `codeflix-ts-usecases-categoria` ·
`codeflix-ts-endpoints-categoria-castmember` · `codeflix-ts-conclusao-projeto`

**Clean Architecture em TypeScript — entidade Product (4)** — `clean-arch-api-product` ·
`clean-arch-notification-pattern` · `clean-arch-usecases-product` · `clean-arch-validacao-product`

**DDD (2)** — `ddd-customer-events` · `ddd-order-repository`

**Monolito (2)** — `monolito-endpoints-api` · `monolito-modulo-invoice`

**Docker / infra (2)** — `docker-nginx` · `docker-k8s-terraform` (o valor já é conhecido; travado pela vírgula)

**Git / CI (2)** — `ci-sonarcloud` · `git-commit-assinado`

**IA / prompt (3)** — `aiops-playbook` · `frameworks-prompt-engineering` · `prompt-langchain`
(o último já é conhecido; travado pela vírgula)

**Outros (2)** — `castmember-python` · `codeflix-upload-video`

### Decisão: o CastMember duplicado (07/08/2026)

Duas skills descreviam o mesmo desafio. A própria `corrige-castmember-python` resolve, na linha 5 do
seu `SKILL.md`:

> *"variante generica/legada. Para entregas Codeflix do MBA, prefira a skill
> `corrige-codeflix-py-api-castmember`."*

**Feito:** a linha de `corrige-castmember-python` foi **removida** do CSV (48 linhas agora). Ela é
fallback genérico e não corresponde a um desafio da plataforma — mapear seria inventar um par. A skill
continua existindo em `$SKILLS_DIR` e pode ser escolhida à mão.

`corrige-codeflix-py-api-castmember` ficou com o `projeto` confirmado pelos 7 irmãos e `fase` em
`REVISAR`, à espera de bloco real.

**Consequência para a F5:** o dropdown de escolha manual de skill (§9.1) precisa listar as skills de
`$SKILLS_DIR`, **não** as linhas do `skills_map` — senão uma skill sem par vira inalcançável, que é
exatamente o caso desta. Vale conferir ao escrever a tela de preview.
