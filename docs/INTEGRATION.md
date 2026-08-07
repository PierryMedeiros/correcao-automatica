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
