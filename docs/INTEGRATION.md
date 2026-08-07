# Integração com a plataforma Full Cycle

Entrega da F0 (plan §13). Este arquivo existe para registrar **o que não sabemos** sobre a API da
plataforma, para que a F9 seja escrita contra a realidade e não contra suposição.

Nada aqui é implementação. O MVP inteiro (F0–F7) roda com origem `manual` — colar o bloco do admin
no intake — que é feature definitiva, não paliativo (plan §9.1). A integração é aditiva.

## Estado atual

| Item | Situação |
|---|---|
| Endpoints da plataforma | Desconhecidos. Nenhuma documentação em mãos. |
| Contato com a equipe da plataforma | Não iniciado. |
| Driver `fc_platform` | Não escrito. As interfaces `OrigemDriver` / `EnvioDriver` existem para acomodá-lo (plan §3). |
| Receptor de webhook | Planejado como dormante — ver abaixo. |
| Botão "Buscar desafios em aberto (FC)" na UI | Existe desabilitado, com aviso "aguardando integração" (plan §9.1). |

## O que assumimos (e que precisa ser confirmado)

Estas premissas moldaram o modelo de dados. Se alguma cair, o impacto está na coluna à direita.

| # | Premissa | Onde impacta se estiver errada |
|---|---|---|
| A1 | Existe (ou existirá) um jeito programático de listar entregas pendentes de correção | Sem isso, origem `manual` é o único caminho — o sistema continua funcionando, só não automatiza o intake |
| A2 | A entrega expõe a URL do repositório do aluno | Bloqueia a correção automática por completo: sem repo não há o que corrigir |
| A3 | A entrega tem um identificador estável do lado da plataforma | `submissoes.external_id` (plan §5); sem ele, a reconciliação vira match por aluno+desafio |
| A4 | Existe um jeito de postar o resultado (status + texto da devolutiva) | Sem isso, envio permanece manual (copiar + marcar enviada), que já é o comportamento do MVP |
| A5 | Aluno e desafio vêm identificados de forma que dê para resolver a skill (algo equivalente a projeto + fase) | `skills_map` faz o lookup por (projeto, fase) — outro formato exige tradução no driver |

## O que 21 blocos reais do admin já mostraram (07/08/2026)

Primeiro contato com dado de verdade, colhido para preencher o `skills_map` (§17.1). O bloco tem esta
forma, e os rótulos são exatamente estes:

```
Interações da Entrega
Projeto: Administração do Catálogo de vídeo com Python
Fase do projeto: Implementar um teste end-to-end
Criado em : 30/12/2025 16:21:04
Repositório: https://github.com/aluno/codeflix-catalog-admin
Aluno: Nome do Aluno
E-mail: aluno@exemplo.com
Celular: +55 31 900000000
```

| # | Achado | Consequência |
|---|---|---|
| O1 | ✅ **O bloco traz `E-mail:` e `Celular:`**, nesta ordem, depois de `Aluno:` — confirmado por captura de tela em 07/08/2026. Os rótulos são exatamente os que o §9.1 previu | O §5 está seguro: `(aluno_email, projeto, fase)` tem chave. `Celular:` é reconhecido e **descartado** (regra dura 6) — o parser da F5 precisa fazer isso de propósito, não por omissão |
| O1b | Os primeiros textos colados no chat vieram **sem** as duas últimas linhas (e-mail e celular) | Sintoma de seleção parcial na cópia, não de campo ausente. O preview do §9.1 já protege: bloco incompleto aponta o campo faltante por linha antes de qualquer coisa entrar |
| O1c | A página da entrega tem um **`Status` (dropdown)** e um **`Feedback` (editor WYSIWYG)** — é ali que a devolutiva é lançada hoje, à mão | Confirma o desenho do §9.4: no MVP a origem `manual` copia o texto e marca como enviada. Para a F9, o campo de feedback é rich text — vale saber se o endpoint aceita Markdown ou HTML |
| O2 | **`Fase do projeto` é truncada em 60 caracteres.** Medido: o valor truncado tem exatamente 60; os outros 18 confirmados têm ≤ 57; um deles usa `LangChain/Smith` no lugar de `LangChain e LangSmith` (63) para caber | O truncamento é estável, então o casamento literal funciona. O risco é outra superfície (API da F9, export) devolver o nome **completo**: o mesmo desafio passaria a ter duas chaves. Vira pergunta 5 abaixo |
| O3 | **`Criado em :` tem espaço antes dos dois-pontos**; `Repositório:` vem com espaço no fim do valor | O parser do §9.1 tem que tolerar espaço ao redor do rótulo e fazer trim do valor — entrada da F5 |
| O4 | **O campo `Repositório:` nem sempre é uma URL clonável.** Em 46 blocos: 8 com `/tree/<branch>[/<subpasta>]`, 1 com `#` solto no fim, 1 com `/pull/7`, 1 com URL de aplicação no Cloud Run. Sufixo `.git` aparece 2 vezes e **funciona** no clone. Cerca de **1 em 5** falharia | O `git ls-remote` do §9.2 passo 1 e o `git clone` do passo 4 rodam **antes de existir agente** — o §10.1 marca `link_invalido` e manda template "sem agente", então não há quem julgue. E `github.com/dono/repo/tree/main` é repositório público perfeitamente acessível: é a URL da barra de endereço. Reprovar por "repositório inacessível" seria devolutiva errada, que é o que o §1 existe para evitar. Normalizar `/tree/…` são poucas linhas e cobre 8 dos 10 casos. Entrada da F5 |
| O4b | **Nem a branch nem a subpasta do `/tree/` mudam o que é avaliado** — só a URL precisa ficar clonável | Corrigido em 07/08/2026 depois de o Pierry apontar o erro: eu tinha escrito que o `<ref>` deveria virar candidato a checkout, o que **contraria o §9.2 e o Apêndice A** — o sistema pina o `commit_sha` no intake e o prompt v2 proíbe `fetch` ou troca de ref. E as próprias skills exigem o código na `main` ("Branch Principal: todo o código deve estar na branch main", texto do enunciado do desafio de EDA). Aluno que aponta para outra branch está violando regra de entrega, e quem julga isso é a skill com o agente. A subpasta, idem: o agente clona o repo inteiro e navega sozinho. **Ação: só normalizar a URL para o clone**; guardar `<ref>` e `<subpasta>` como observação no job é opcional, e serve ao revisor humano, não ao roteamento |
| O4c | **Nem toda entrega é repositório de código.** `corrige-ci-sonarcloud` recebe URL de **pull request** (é o que a skill pede) e o desafio do Cloud Run recebeu a **URL da aplicação publicada** | Dois casos distintos: o PR é entrega legítima e a validação tem que aceitá-la; a URL do Cloud Run é entrega errada do aluno, e merece devolutiva específica ("você enviou a aplicação publicada, não o repositório") em vez do template genérico de repositório inacessível. Entrada da F5 e do §10 |
| O5b | **O mesmo curso aparece sob `Projeto` diferentes.** Desafios de Go estão em `GoLang` (Multithreading, Client-Server-API, Clean Architecture) **e** em `Desafios Pós Go Expert` (Rate Limiter, Stress test) **e** em `Desafio Google Cloud Run` (temperatura por CEP) e `Desafio Leilão` | Reforça O5: `Projeto` é rótulo livre de agrupamento, não hierarquia. Espelhar os dois campos continua sendo a decisão certa; deduzir seria errado |
| O5 | **`Projeto` não é o curso.** O estilo varia: programa (`Desafios MBA IA`), módulo (`Administração do Catálogo de vídeo com Python`) ou desafio único (`Desafio Leilão`). FC 3.0 / FC 4.0 / Pós / MBA não aparecem | O `skills_map` faz bem em espelhar os dois campos em vez de modelar a hierarquia. Mas reforça a premissa A5: nada garante que o par identifique o desafio de forma única no catálogo inteiro |
| O6 | **Nome de desafio pode conter vírgula** (`Do compose ao cluster: Docker, Kubernetes e Terraform`) | O CSV do seed precisa de aspas RFC 4180 ou outro separador — F1.6 |

## Perguntas abertas para a equipe da plataforma

### 1. Listagem de entregas pendentes

- Existe endpoint que liste as entregas aguardando correção? Qual método/rota?
- **A resposta inclui a URL do repositório do aluno?** (Se não incluir, a integração não serve para o
  nosso caso — é a pergunta mais importante desta lista.)
- Quais campos vêm junto: nome, e-mail, projeto, fase, data de entrega, número da tentativa?
- Há paginação? Dá para filtrar por status ou por período?
- Como a entrega é marcada como "em correção" para não ser listada duas vezes?

### 2. Postar status e feedback

- Existe endpoint para devolver o resultado de uma correção? Qual método/rota?
- Que valores de status ele aceita? Eles mapeiam para nosso veredito
  (`aprovado`, `aprovado_com_observacao`, `reprovado`)? O que fazer com `inconclusivo`,
  que não é veredito de aluno e sim pedido de revisão humana?
- O texto da devolutiva aceita Markdown? Há limite de tamanho?
- A operação é idempotente? Reenviar o mesmo resultado duplica ou sobrescreve?
- Dá para corrigir um envio errado (editar/retirar), ou o envio é definitivo?

### 3. Webhook

- Existe webhook de "nova entrega"? Se sim, como se registra a URL de destino?
- Qual o formato do payload? (Não precisamos da spec: um exemplo real de payload já resolve.)
- Há assinatura/HMAC para validar a origem? Qual header e qual algoritmo?
- Qual a política de retry se nosso endpoint estiver fora do ar?
- Se não existe webhook, polling é aceitável? Qual intervalo não incomoda a plataforma?

### 5. Campos da entrega (levantadas dos blocos reais — ver seção acima)

- **O e-mail do aluno está disponível em algum lugar?** É a mais urgente: o modelo de dados usa
  `(aluno_email, projeto, fase)` como chave de submissão ativa e de nova tentativa.
- **`Fase do projeto` é truncada em 60 caracteres no admin.** Esse limite é do banco ou só da tela?
  Se um endpoint devolver o nome completo, o mesmo desafio terá duas chaves diferentes.
- Existe um **identificador estável do desafio** (id numérico, slug) que dispense casar por texto?
  Seria melhor chave que `(projeto, fase)` e resolveria truncamento, acento e vírgula de uma vez.
- O campo `Projeto` tem um valor canônico, ou é texto livre editável por quem cadastra o desafio?

### 4. Autenticação

- Como se autentica: API key, OAuth, token de serviço?
- Como se obtém e como se rotaciona a credencial?
- Há rate limit? Qual, e qual o comportamento ao estourar (429? backoff sugerido?)?
- Existe ambiente de homologação, ou só produção? (Testar driver contra produção com entregas
  reais de alunos é risco que preferimos não correr.)

## Receptor dormante

O plano prevê `POST /webhooks/fc` (plan §3) que **não interpreta nada**: só grava headers e body
bruto em `webhook_payloads`. A ideia é ligá-lo assim que a plataforma puder disparar eventos e
acumular payloads reais **antes** de escrever o driver — assim o driver nasce contra o formato de
verdade, e não contra o que imaginamos que ele seja.

Isso significa que a pergunta "qual o formato do payload?" (§3 acima) é a de menor urgência:
se conseguirmos apenas que disparem eventos para uma URL nossa, o formato a gente descobre.

## Como as respostas viram código

Cada resposta obtida deve ser registrada na tabela abaixo e, se contradisser uma premissa A1–A5,
o impacto vai para o plano (Apêndice B) antes de virar código — a regra de divergência vale aqui
como em qualquer outro lugar.

| Data | Pergunta | Resposta | Consequência |
|---|---|---|---|
| — | — | Nenhuma resposta ainda | — |
