# Skills de Correcao de Desafios - Full Cycle

Colecao de 49 skills para o Claude Code que automatizam a correcao de desafios dos cursos Full Cycle. Cada skill avalia um desafio especifico, executa testes quando possivel e gera devolutivas personalizadas para os alunos.

Alem das 49 skills de correcao, o repositorio tem duas meta-skills, que cobrem as duas pontas do ciclo de vida de um desafio:

- `criar-desafio-fullcycle` — escreve o **enunciado** de um desafio novo, do levantamento de contexto ate o texto final revisado.
- `cria-skill-correcao` — a partir de um enunciado pronto, gera a **skill `corrige-*`** que corrige as entregas daquele desafio.

O fluxo completo de um desafio novo, portanto, e: primeiro a `criar-desafio-fullcycle` escreve o enunciado; depois a `cria-skill-correcao` recebe esse enunciado e gera a skill de correcao; a partir dai as entregas dos alunos sao corrigidas pela skill `corrige-*` resultante.

> ## REGRA OBRIGATORIA: SKILL NOVA SE CRIA COM A SKILL
>
> **Toda skill de correcao nova (`corrige-*`) DEVE ser criada pela skill `cria-skill-correcao`.
> Nunca escreva uma skill de correcao na mao, nem copiando e adaptando a pasta de outra skill.**
>
> Isso vale para qualquer pessoa e para qualquer IA que mexa neste repositorio. A skill
> `cria-skill-correcao` pede o enunciado original do desafio, le 5 skills existentes para
> extrair o padrao vigente e gera `SKILL.md` + `devolutivas.md` ja no formato correto. E o
> que mantem as 49 skills consistentes entre si (frontmatter, blocos obrigatorios, tom das
> devolutivas). Skill escrita a mao diverge do padrao e quebra essa consistencia.
>
> Ver "Criando uma skill para um desafio novo" abaixo.

## Instalacao

Clone este repositorio dentro da pasta `skills` do Claude Code na sua maquina:

```bash
cd ~/.claude/skills
git clone <url-deste-repo> correcao
```

Apos clonar, o Claude Code vai detectar automaticamente todas as skills. Nenhuma configuracao adicional e necessaria.

## Pre-requisitos

Para que as skills funcionem corretamente, sua maquina deve ter:

- **Claude Code** (CLI da Anthropic)
- **Docker e Docker Compose** (para desafios que sobem containers)
- **Go 1.21+** (para desafios Go Expert)
- **Node.js 18+ e npm** (para desafios TypeScript/Node)
- **Python 3.10+** (para desafios Python/Django)
- **gh CLI** (GitHub CLI, para o desafio de commit assinado)

## Como usar

1. Receba a lista de desafios com nome do aluno, fase do projeto e link do repositorio
2. Clone os repos dos alunos em `/aluno/`
3. Peca para o Claude Code corrigir — ele identifica automaticamente a skill correta pelo nome do desafio
4. Apos corrigir, rode `./cleanDocker.sh` para limpar containers e imagens
5. O Claude gera um relatorio com devolutivas personalizadas para cada aluno

## Estrutura de cada skill

Cada pasta de skill contem:

```
corrige-nome-do-desafio/
  SKILL.md          # A skill em si (instrucoes para a IA avaliar o desafio)
  devolutivas.md    # Guia de como escrever devolutivas + exemplos especificos
  .env.exemplo      # Template de chaves de API (copie para .env e preencha)
  README.md         # Avisos para o suporte (apenas nas skills com restricoes)
```

- `SKILL.md` — contem os criterios de avaliacao, como executar, e logica de aprovacao/reprovacao
- `devolutivas.md` — guia de tom/estilo e exemplos de devolutivas (aprovado e reprovado) especificos para aquele desafio. A IA le este arquivo antes de redigir a devolutiva ao aluno.

## Criando o enunciado de um desafio novo

Use a skill `criar-desafio-fullcycle`. Ela conduz a criacao do desafio de ponta a ponta e serve
para qualquer curso da casa (FC 4.0, MBAs, pos), inclusive para revisar ou atualizar um desafio
que ja existe.

```
> use a skill criar-desafio-fullcycle
(a skill entrevista voce: curso/modulo, lista de aulas, repo do professor, desafios ja publicados)
```

O que ela faz:

1. Coleta o contexto do modulo e analisa o repositorio do professor, quando existe.
2. Apresenta de 3 a 6 **ideias** de desafio e para, esperando voce escolher. Voce decide, ela sugere.
3. Fecha o escopo com voce (o que entra, o que fica fora, nomes fixados, limites numericos).
4. Escreve o enunciado no padrao da casa e roda um checklist de revisao anticontradicoes.
5. Recomenda rodar o desafio como um "aluno de teste" antes de publicar.

A pasta da skill tem `references/` (a anatomia do enunciado e o checklist de revisao) e `exemplos/`
com quatro enunciados reais que definem o padrao. O enunciado sai em `.md`, pronto para virar README
de repositorio. Para publicar no editor da plataforma, converta com a skill `enunciado-to-html`.

Depois que o enunciado estiver fechado, passe-o para a `cria-skill-correcao` gerar a skill que corrige
as entregas.

## Criando uma skill para um desafio novo

**Sempre use a skill `cria-skill-correcao`.** Chegou desafio novo na trilha? Nao abra um
editor: chame a skill. Ela e o unico caminho suportado para adicionar um `corrige-*` aqui.

```
> use a skill cria-skill-correcao
(a skill pede o enunciado original; cole o texto, o caminho do arquivo .md/.pdf, ou a URL)
```

O que ela faz:

1. Pede o **enunciado original** do desafio, que e a unica fonte das regras de correcao.
2. Le o `_shared/devolutivas-guide.md` e **5 skills de correcao sorteadas** para extrair o
   padrao vigente (estrutura, frontmatter, tom).
3. Separa as exigencias do enunciado em criterio duro (reprova), observacao cosmetica
   (aprova com ressalva) e fora de escopo (ignora).
4. Gera `corrige-<slug>/SKILL.md` e `corrige-<slug>/devolutivas.md` no padrao das demais.
5. Atualiza este README (contagem e categoria).

Nao crie a pasta manualmente, nem via copiar-e-colar de outra skill: o padrao evolui e a
skill de criacao sempre le as skills atuais antes de escrever, entao ela acompanha essa
evolucao. Copia manual congela um padrao velho e introduz divergencia.

Se voce precisar mudar o padrao de **todas** as skills, altere o `_shared/devolutivas-guide.md`
e/ou o `cria-skill-correcao/SKILL.md`, nunca so numa skill isolada.

## Configuracao de Chaves de API

Algumas skills precisam de chaves de API para executar os desafios. Cada uma dessas skills
tem um arquivo `.env.exemplo` com os campos vazios. Para configurar:

1. Entre na pasta da skill que precisa de chave
2. Copie o `.env.exemplo` para `.env`
3. Preencha os valores no `.env`

```bash
cd corrige-temperatura-cep
cp .env.exemplo .env
# Edite o .env e preencha as chaves
```

**Skills que precisam de chave:**

| Skill | Arquivo | Chaves |
|---|---|---|
| corrige-temperatura-cep | `.env.exemplo` | `WEATHER_API_KEY`, `OPEN_WEATHERMAP_API_KEY` |
| corrige-tracing-distribuido | `.env.exemplo` | `WEATHER_API_KEY`, `OPEN_WEATHERMAP_API_KEY` |
| corrige-langchain-postgres | `.env.exemplo` | `OPENAI_API_KEY` ou `GOOGLE_API_KEY` |
| corrige-prompt-langchain | `.env.exemplo` | `OPENAI_API_KEY` ou `GOOGLE_API_KEY`, `LANGCHAIN_API_KEY` |

## Skills com correcao ESTATICA (falta de chave de API)

Os desafios abaixo sao corrigidos apenas por leitura de codigo. As chaves de API
necessarias (OpenAI, Google Gemini, LangSmith) **geram custo por uso**, e cada correcao
consome tokens da API. Por isso, a analise esta configurada como estatica por padrao.

| Skill | Chaves necessarias | Custo |
|---|---|---|
| corrige-langchain-postgres | OpenAI ou Google Gemini | Custo por tokens (ingestao + chat) |
| corrige-prompt-langchain | OpenAI/Gemini + LangSmith | Custo por tokens (avaliacao de prompts) |

Se voce tiver as chaves e aceitar o custo, pode habilitar a execucao pratica
seguindo as instrucoes abaixo.

### Como habilitar execucao pratica nesses desafios

Alem de preencher o `.env`, voce deve alterar o trecho do
`SKILL.md` de cada skill para trocar de analise estatica para execucao pratica.

**Para `corrige-langchain-postgres/SKILL.md`**, substitua este trecho:

```
**MODO DE AVALIACAO: Analise estatica + execucao de testes (se houver).**

Este desafio depende de chaves de LLM (OpenAI/Google Gemini) para executar a aplicacao. Como essas chaves podem nao estar disponiveis, a avaliacao e baseada na **leitura dos arquivos** (chunk_size, chunk_overlap, k=10, regras do prompt, PGVector).

Se o projeto contiver testes automatizados que nao dependam de chave de LLM, execute-os:
1. Execute `pip install -r requirements.txt` e `pytest` (ou equivalente) no diretorio do projeto.
2. Inclua o resultado dos testes na avaliacao.

A analise estatica dos arquivos e suficiente para aprovar ou reprovar.
```

Por este:

```
**MODO DE AVALIACAO: Analise estatica + execucao pratica.**

**Chaves de API:** Carregue as chaves do arquivo `.env` nesta mesma pasta da skill.

Alem de ler os arquivos, voce DEVE executar o projeto para validar o funcionamento:
1. Carregue as variaveis: `export $(grep -v '^#' /caminho/para/.env | xargs)`
2. Execute `docker compose up -d` para subir o PostgreSQL.
3. Execute `pip install -r requirements.txt` e `python src/ingest.py` para testar a ingestao.
4. Execute `python src/chat.py` e faca uma pergunta de teste.
5. Ao final, execute `docker compose down -v` para limpar.
6. Inclua os resultados na avaliacao.
```

**Para `corrige-prompt-langchain/SKILL.md`**, substitua este trecho:

```
**MODO DE AVALIACAO: Analise estatica + execucao de testes (se houver).**

Este desafio depende de chaves de LLM (OpenAI/Google Gemini) e LangSmith para executar a aplicacao. Como essas chaves podem nao estar disponiveis, a avaliacao e baseada na **leitura dos arquivos** (prompt v2, 6 testes, README com resultados).

Se o projeto contiver testes automatizados que nao dependam de chave de LLM, execute-os:
1. Execute `pip install -r requirements.txt` e `pytest tests/` no diretorio do projeto.
2. Inclua o resultado dos testes na avaliacao.

A analise estatica dos arquivos e suficiente para aprovar ou reprovar.
```

Por este:

```
**MODO DE AVALIACAO: Analise estatica + execucao pratica.**

**Chaves de API:** Carregue as chaves do arquivo `.env` nesta mesma pasta da skill.

Alem de ler os arquivos, voce DEVE executar o projeto:
1. Carregue as variaveis: `export $(grep -v '^#' /caminho/para/.env | xargs)`
2. Execute `pip install -r requirements.txt`.
3. Execute `pytest tests/` para rodar os testes.
4. Se possivel, execute os scripts de push/pull de prompts.
5. Inclua os resultados na avaliacao.
```

## Total de skills: 49

### Go Expert
- corrige-client-server-api
- corrige-multithreading-cep
- corrige-clean-architecture-go
- corrige-temperatura-cep
- corrige-stress-test-go
- corrige-rate-limiter
- corrige-tracing-distribuido
- corrige-leilao-goroutines

### Docker
- corrige-docker-nginx
- corrige-docker-go-otimizado
- corrige-docker-node-api-producao

### Clean Architecture (TypeScript)
- corrige-clean-arch-notification-pattern
- corrige-clean-arch-validacao-product
- corrige-clean-arch-usecases-product
- corrige-clean-arch-api-product

### DDD Patterns (TypeScript)
- corrige-ddd-order-repository
- corrige-ddd-customer-events

### Sistemas Monoliticos (TypeScript)
- corrige-monolito-endpoints-api
- corrige-monolito-modulo-invoice

### Codeflix TypeScript
- corrige-codeflix-ts-entidade-categoria
- corrige-codeflix-ts-usecases-categoria
- corrige-codeflix-ts-repositorio-validacao-categoria
- corrige-codeflix-ts-endpoints-categoria-castmember
- corrige-codeflix-ts-conclusao-projeto

### Codeflix Python
- corrige-codeflix-py-api-castmember
- corrige-codeflix-py-patch-api-categoria
- corrige-codeflix-py-usecase-update-genre
- corrige-codeflix-py-update-api-genre
- corrige-codeflix-py-paginacao-refatoracao
- corrige-codeflix-py-video-api
- corrige-codeflix-py-token-jwt
- corrige-codeflix-py-teste-e2e-video

### Codeflix Laravel
- corrige-codeflix-upload-video

### Python/Django
- corrige-castmember-python

### TDD
- corrige-tdd-reservas

### IA/ML
- corrige-langchain-postgres
- corrige-prompt-langchain
- corrige-aiops-playbook
- corrige-frameworks-prompt-engineering
- corrige-skills-refactor-arch

### EDA
- corrige-eda-balances-kafka

### CI/CD
- corrige-ci-sonarcloud

### Git
- corrige-git-commit-assinado

### MBA IA
- corrige-streamtube-upload-videos
- corrige-design-docs-ia

### MBA Arquitetura Hexagonal (Java)
- corrige-hexagonal-cancelamento-evento

### MBA Arquitetura DDD (TypeScript/Nest.js)
- corrige-ddd-lista-espera-ingressos

### MBA Arquitetura Infra (Docker/Kubernetes/Terraform)
- corrige-docker-k8s-terraform

### MBA Arquitetura Design Patterns (TypeScript)
- corrige-fechamento-faturamento
