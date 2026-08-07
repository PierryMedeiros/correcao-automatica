# F9 — Integração FC

> **Status:** ⬜ não iniciada — bloqueada por terceiros
> **Estimativa:** não estimada; dimensionar quando as respostas da plataforma chegarem (plan §13)
> **Depende de:** F5 (interfaces de driver e receptor dormante) · F6 (botão de busca de pendentes)
> **Destrava:** nenhuma fase — pode acontecer antes, depois ou em paralelo ao endurecimento
> **Seções do plano:** §3 (drivers, receptor dormante) · §9.1 · §9.4 · §13 F9 · §15 (risco "API da FC diferente do assumido") · `docs/INTEGRATION.md`

## Objetivo

A origem `fc_platform` deixa de ser interface vazia: entregas entram sozinhas e a devolutiva aprovada
volta para a plataforma sem copiar e colar. O pipeline não muda — o driver é aditivo, e a origem
`manual` segue definitiva para a outra plataforma (§9.1, §9.4). **Este arquivo é esboço** e só vira
plano executável quando as perguntas do `docs/INTEGRATION.md` forem respondidas: detalhar antes é
escrever contra suposição, que é o que o receptor dormante existe para evitar.

## Pré-condições

- [ ] F5 e F6 marcadas ✅ em `docs/fases/README.md` — são as dependências de grafo desta fase (`Depende de:` acima)
- [ ] MVP aprovado pelo chefe (marco pós-F7 do §13) — pré-condição **de negócio, não de grafo**: por isso a F7 não entra em `Depende de:`; verificar o registro da aprovação em `docs/STATUS.md`
- [ ] `POST /webhooks/fc` dormante existe e grava em `webhook_payloads`; se não nasceu na F5, é a primeira tarefa de F9.1
- [ ] `docs/INTEGRATION.md` deixou de dizer "Contato com a equipe da plataforma: não iniciado"
- [ ] Credencial da plataforma no `.env` do host (regra dura 5), assim que o tema 4 for respondido

## Decisões do plano que esta fase materializa

| Decisão | Onde está | Consequência prática nesta fase |
|---|---|---|
| Receptor dormante grava payload bruto e não interpreta nada | §3, `INTEGRATION.md` | F9.1 não escreve parser: o driver nasce depois, contra payload real |
| `origem` é campo de domínio, não gambiarra; envio é por origem | §5, §9.1, §9.4 | O driver preenche `origem=fc_platform` e `external_id` e substitui o envio **só** dessa origem |
| Falha do driver devolve para `pronta_envio` + notificação; divergência da API fica isolada no driver | §9.4, §6, §15 | Nenhum estado novo é criado (regra dura 3), e premissa A1–A5 que cair não vaza para o domínio — vira nota no Apêndice B |

## Decisões a tomar nesta fase

| # | Pergunta em aberto | Opções | Recomendação |
|---|---|---|---|
| D1 | Como a plataforma alcança `POST /webhooks/fc` se o sistema roda em WSL2 local (§1, não-objetivo "deploy web")? | túnel temporário só para captura · esperar a F8 · abrir mão do webhook e usar polling | Túnel temporário em F9.1, janela curta; operação permanente só depois da F8 |
| D2 | O que o driver posta quando o veredito é `inconclusivo` (tema 2)? | mapear para `reprovado` · nunca postar | Nunca postar: o envio parte de `pronta_envio`, e ali o `veredito_final` do revisor já é um dos três (§6); `inconclusivo` chegando ao driver é erro de programação |
| D3 | Entrega vinda da plataforma passa pelo preview obrigatório do §9.1? | preview pré-preenchido · criar submissão direto em `recebida` | Direto: preview obrigatório é regra do intake **manual**, e a validação do §6 (`link_invalido`, `sem_skill`) já é a rede desta origem |
| D4 | Polling é fallback do webhook ou fica sempre ligado? | só se não houver webhook · sempre, como rede de segurança | Sempre ligado, no intervalo acordado: webhook perdido em silêncio é correção perdida, e perder correção é bug (§2.8) |
| D5 | `webhook_payloads` guarda body bruto, que pode trazer celular do aluno — conflita com a regra dura 6 / §11? | gravar bruto com retenção curta e expurgo pelo janitor · redigir campos sensíveis na gravação | Gravar bruto com retenção definida (o valor do receptor é a integridade do payload). **Exige atualizar §11 e o Apêndice B antes de implementar**: o plano não define retenção dessa tabela |
| D6 | O que fazer quando a plataforma listar de novo uma entrega já em correção (tema 1)? | dedupe nosso por `external_id` · confiar na marcação da plataforma | Dedupe nosso, apoiado no índice único parcial do §5; sem id estável (A3), cai para match por aluno+projeto+fase |

## Etapas

Cada etapa é destravada por uma resposta específica do `docs/INTEGRATION.md`; começar antes dela é escrever driver contra suposição, e a ordem F9.1 → F9.2 existe por isso.

### F9.1 — Receptor ligado, payload real acumulado

**Destrava:** tema 3 — basta conseguirem disparar evento para uma URL nossa; o formato a gente descobre. **Entrega:** payloads reais em `webhook_payloads`, sem interpretação, prontos para virar fixture.

- [ ] Registrar a URL de destino (ver D1) e confirmar com um evento disparado pela plataforma
- [ ] Validar o payload como input externo (tamanho, content-type) sem parsear conteúdo, e congelar 3+ payloads reais como fixture de F9.2

**Testes:** contrato do endpoint (grava body e headers brutos; responde 2xx a body desconhecido). **Pronto quando:** há linha em `webhook_payloads` vinda da plataforma, não de `curl` local.

### F9.2 — `OrigemDriver` fc_platform

**Destrava:** tema 1 **com a URL do repositório na resposta**, mais o tema 4 (premissas A1, A2, A3, A5). **Entrega:** o botão "Buscar desafios em aberto (FC)" da F6 sai do desabilitado e cria submissões; o polling cobre o que o webhook perder.

- [ ] Implementar por trás da interface existente (nenhuma interface nova, CLAUDE.md), traduzindo os campos da plataforma para (projeto, fase) do `skills_map` — sem match → `sem_skill`
- [ ] Preencher `origem=fc_platform` e `external_id`, aplicar o dedupe da D6, timeout e backoff em toda chamada de saída
- [ ] Reconciliação por polling como job cron pg-boss idempotente, respeitando a pausa global (§12)

**Testes:** tradução payload real → submissão; dedupe; par sem skill; idempotência do cron. **Pronto quando:** o botão cria submissões que entram na fila pelo mesmo caminho do intake manual, e rodar a reconciliação 2× sobre a mesma entrega produz uma submissão só.

### F9.3 — `EnvioDriver` fc_platform

**Destrava:** tema 2 mais o tema 4 (premissa A4). **Entrega:** devolutiva aprovada volta para a plataforma; `pronta_envio → enviada` sem copiar e colar.

- [ ] Mapear `veredito_final` para o status da plataforma aplicando a D2, registrando cada tentativa em `eventos` (§12)
- [ ] Falha do driver: permanece em `pronta_envio` + notificação (§9.4), nunca estado novo

**Testes:** mapeamento de veredito; 401/429/5xx/timeout não movem a submissão para terminal. **Pronto quando:** a devolutiva aparece na plataforma e a submissão fica `enviada`.

### F9.4 — Fechar o `INTEGRATION.md`

**Destrava:** todas as respostas obtidas. **Entrega:** o arquivo deixa de listar perguntas em aberto e passa a documentar a integração real.

- [ ] Preencher a tabela "Como as respostas viram código" com data, resposta e consequência
- [ ] Premissa A1–A5 derrubada → registrar o impacto no Apêndice B antes de qualquer código

**Testes:** nenhum — verificação é leitura do arquivo. **Pronto quando:** nenhuma pergunta segue sem resposta ou sem um "não existe, decidimos X".

## Edge cases do §10 cobertos aqui

| # | Caso | Como esta fase trata | Onde é verificado |
|---|---|---|---|
| 3 | (projeto, fase) sem skill | Tradução do driver não acha o par → `sem_skill`, igual ao manual | F9.2, aceite A2 |
| 5 | Nova entrega com a anterior ainda ativa | Índice único parcial do §5 substitui; a origem não muda a regra | F9.2 (dedupe, D6) |
| — | Entrega listada duas vezes pela plataforma | Caso **ausente da matriz do §10**: só existe com integração ativa. Entra nela pelo Apêndice B quando a fase for dimensionada | F9.2 (D6) |

## Critérios de aceite

Provisórios: cada um vale enquanto a premissa correspondente sobreviver ao contato com a plataforma; aceite cuja premissa cair é reescrito junto com o registro no Apêndice B, não apagado em silêncio.

| # | Critério | Como provar | Evidência esperada |
|---|---|---|---|
| A1 | Receptor recebe evento real | Disparo pela plataforma (D1) | Linha em `webhook_payloads` com headers e body brutos |
| A2 | Botão FC cria submissões corretas e não duplica | Clicar com N entregas pendentes; rodar a reconciliação 2× | N submissões `origem=fc_platform` com `external_id`, validadas pelo §6, sem duplicata |
| A3 | Envio real fim a fim | Aprovar uma devolutiva e enviar | Devolutiva visível na plataforma; submissão `enviada`; linha em `eventos` |
| A4 | Falha do driver não perde correção | Forjar 401/500 no endpoint | Submissão segue em `pronta_envio` + notificação |
| A5 | `INTEGRATION.md` respondido | Ler o arquivo | Tabela de respostas preenchida; premissa derrubada citada no Apêndice B |

- [ ] A1
- [ ] A2
- [ ] A3
- [ ] A4
- [ ] A5

## Testes que nascem nesta fase

- Tradução payload real → submissão, usando como fixture os payloads capturados em F9.1 (nunca payload imaginado), com dedupe e par sem skill.
- Mapeamento `veredito_final` → status da plataforma, incluindo a recusa de `inconclusivo` (D2), e os caminhos de erro do driver (401, 429, 5xx, timeout) com o comportamento do §9.4.
- Idempotência do consumo de webhook e do job de reconciliação.

## Riscos e armadilhas

- **Testar contra produção com entregas reais de alunos.** "Dá para corrigir um envio errado?" (tema 2) segue sem resposta; sem ambiente de homologação, o aceite A3 não roda antes dela.
- **Escrever o driver contra a spec imaginada** — é o risco §15; a mitigação é a ordem F9.1 → F9.2, não boa intenção. Rate limit desconhecido (tema 4) entra na mesma conta: polling agressivo derruba a integração antes de ela existir.
- **`webhook_payloads` acumulando PII** (D5): não implementar F9.1 antes de decidir a retenção.
- **Máquina local não recebe conexão de entrada**: o receptor existe desde a F5, mas ninguém consegue chamá-lo enquanto o sistema rodar na WSL2 local (D1).

## O que NÃO entra nesta fase

- Auth, deploy em host, socket proxy, egress restrito → F8
- Tela nova: a F6 já entregou o botão; UI além de habilitá-lo é escopo novo
- Envio automático da origem `manual` (§9.4 define copiar + marcar como definitivo) e intake automático da segunda plataforma de cursos (segue manual, por volume — §9.1) → nunca
- Estado novo para representar "postando na FC" → §6 basta; estado novo exige plano primeiro (regra dura 3)

## Impacto em fases seguintes

A preencher no encerramento da fase.

| O que mudou aqui | Fase afetada | O que foi atualizado lá |
|---|---|---|

## Registro de execução

A preencher durante a fase.

- **Iniciada em:** AAAA-MM-DD
- **Concluída em:** AAAA-MM-DD
- **Decisões tomadas:**
- **Divergências do plano:**
- **Evidência dos aceites:**
