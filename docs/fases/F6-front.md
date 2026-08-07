# F6 — Front

> **Status:** ⬜ não iniciada
> **Estimativa:** 4–6 dias úteis (plan §13)
> **Depende de:** F5 (REST, SSE e preview do intake)
> **Destrava:** F7 (o marco do MVP é a demo pelas telas) · F9 (o botão da plataforma nasce aqui, desabilitado)
> **Seções do plano:** §3 (SPA e tópicos SSE) · §4 (stack do front) · §9.1 (intake) · §9.3 (revisão) · §9.4 (envio) · §12 (métricas, SSE, pausa global) · §6 e §6.1 (transições humanas) · §5 (devolutivas) · §10.1–3, §10.8, §10.17, §10.21–23, §10.25–27

## Objetivo

Ao fim desta fase o sistema deixa de ser operável só por `curl`: existe uma SPA que cobre o ciclo
inteiro de uma submissão — colar o bloco, acompanhar a fila ao vivo, revisar e editar a devolutiva,
enviar e conferir no histórico —, com notificações e pausa global à mão. O front não decide nada de
domínio: ele exibe o que a API diz e oferece exatamente as transições humanas do §6.

## Pré-condições

- [ ] F5 marcada ✅ no título da fase no §13 do `docs/project-plan.md` e no índice `docs/fases/README.md`
- [ ] API de pé em watch e respondendo: `curl -s -o /dev/null -w '%{http_code}' http://localhost:<porta>/<rota de submissões>` = 200
- [ ] Rota SSE mantém conexão aberta: `curl -N http://localhost:<porta>/<rota sse>` recebe evento quando uma submissão muda de estado em outro terminal
- [ ] Contrato REST real levantado antes de escrever o client: `rg '@(Get|Post|Patch|Put|Delete)\(' apps/api/src --no-heading` lista rota para cada recurso entregue pela F5 (submissões, correções, transcript, devolutivas, runs e suas ações, notificações, config, métricas do dashboard); rota ausente é buraco da F5 e volta para lá — o front não improvisa endpoint (o único delta previsto aqui é o de filtro do histórico, ver D5)
- [ ] Pipeline real disponível para a demo: `.env` com `CLAUDE_CODE_OAUTH_TOKEN` válido (§17.3) e ao menos o golden repo G1 acessível via `file://` (§17.2, mesmo insumo do aceite da F3)
- [ ] Postgres de dev de pé (`docker compose up -d`) com migrations e seed da F1 aplicados
- [ ] Node/pnpm carregados no shell que vai rodar `pnpm dev` (armadilha registrada no `docs/STATUS.md`: nvm não carrega em shell não-interativo)

## Decisões do plano que esta fase materializa

| Decisão | Onde está | Consequência prática nesta fase |
|---|---|---|
| REST é a fonte da verdade; SSE é notificação | §10.22, §12 | O composable de SSE nunca aplica o payload do evento no estado: todo evento dispara refetch da rota correspondente, e toda reconexão refaz o fetch das telas montadas |
| Intake manual é feature definitiva, não paliativo | §9.1 | A tela nasce completa; o botão "Buscar desafios em aberto (FC)" existe desabilitado com aviso "aguardando integração" (vira driver na F9) |
| Preview obrigatório — nada entra sem confirmação | §9.1, §10.23 | Nenhuma submissão é criada direto do textarea; a confirmação fica travada enquanto houver linha inválida |
| Parser e validação do bloco moram no servidor | §9.1, §4, F5 | O front envia o texto **cru** e renderiza o resultado por linha; não re-parseia nem revalida no cliente (duplicar isso cria duas versões da verdade) |
| Humano é a autoridade sobre o veredito | §9.3, §6 | Aprovar para envio permite trocar o veredito, e `veredito_final` é campo próprio |
| `texto_agente` é imutável | §5, CLAUDE.md regra dura 7 | A UI edita apenas `texto_final` e exibe o rascunho original somente-leitura ao lado; nenhuma requisição do front carrega `texto_agente` |
| 1 run ativo por vez no MVP, e o run tem ciclo de vida próprio | §10.21, §5 (`runs.status`), §6.1 | Botão iniciar desabilitado com explicação, não escondido; o painel lê `GET /api/runs/:id` e as transições **humanas** de `runs.status` (cancelar, pausar, retomar) são chamadas às rotas entregues por F4/F5 — `finalizado` é automático e não tem botão, e a UI não deduz status de run |
| Trava de revisão do §2.7 | §2.7, §6 | A UI não oferece atalho para pular revisão de item com dúvida, gatilho ou veredito `inconclusivo` — o estado vem do servidor e a tela obedece |
| Métricas do dashboard no MVP são quatro, e vêm prontas da API | §12, entregues em `GET /api/metricas/dashboard` (F5.8) | Contadores por estado, tempo médio de correção em 24h, taxa de aprovação por skill e gatilhos por tipo — a F6 só consome, não agrega nada; `gatilhos por tipo` vem vazio enquanto a F7 não popular `correcoes.gatilhos`, e nada além das quatro entra (tendências e exportação são F8) |
| O transcript é servido pela API, não pelo caminho de arquivo | §9.3, §5 (`correcoes.transcript_path`), entregue em `GET /api/correcoes/:id/transcript` (F5.8) | O link do card de revisão aponta para essa rota; o front nunca monta nem envia caminho de arquivo (a F5 resolve o caminho do banco e recusa o que estiver fora de `JOBS_DIR`) |
| Datas em UTC no banco, exibidas em America/Sao_Paulo | CLAUDE.md (Convenções) | Um único helper de formatação com `timeZone` explícito; nenhum componente formata data por conta própria |
| Envio manual = copiar + marcar enviada | §9.4, §6 | Duas ações distintas; `link_invalido` tem o par próprio ("copiar devolutiva padrão e marcar enviada") |
| Pacote nasce na fase que o preenche | `docs/STATUS.md`, 07/08/2026 | `apps/web` não existe hoje: a F6.1 cria o pacote do zero dentro do workspace já declarado |

## Decisões a tomar nesta fase

| # | Pergunta em aberto | Opções | Recomendação |
|---|---|---|---|
| D1 | O banner de gatilho agregado 3+ (§10.27) é componente da F6, mas a agregação é backend da F7 — o que ele consome enquanto isso? | (a) componente ligado desde já ao endpoint de agregação da F7, oculto enquanto a rota devolver vazio; (b) mock no front até a F7 chegar | (a) — mock vira código morto que a F7 tem que caçar (D9 da F7). O componente nasce ligado à rota; sem contagem, sem banner. As provas do banner são do aceite da F7, não desta fase |
| D2 | Quanto estado do servidor vai para o Pinia? | (a) store por tela; (b) store só para o que é global | (b) — notificações, pausa global, run ativo e status da conexão. Listas de tela ficam em composable local com refetch (skill `implementar-fase`: não duplicar estado do servidor em store sem necessidade) |
| D3 | Como web e API conversam em dev? | (a) proxy do Vite em `/api` e na rota SSE; (b) `VITE_API_URL` absoluta + CORS na API | (a) — mesma origem elimina CORS e simplifica o `EventSource`; a URL absoluta volta a fazer sentido só na F8 (deploy) |
| D4 | Que nível de teste o front tem? | (a) vitest + `@vue/test-utils` para composables e componentes de lógica; (b) somar Playwright/Cypress | (a) — o aceite desta fase é demo manual e a suite E2E da F7 é de backend/golden repos. Teste de browser não está no plano; se virar necessidade, é decisão registrada, não iniciativa |
| D5 | Os filtros do histórico (estado/skill/aluno/período) são server-side ou client-side? | (a) query params na API, paginação lazy; (b) trazer tudo e filtrar no DataTable | (a) — ~50 submissões/dia acumulam rápido, e filtro client-side sobre página parcial mente. Se a rota da F5 ainda não aceita filtro, o delta entra aqui e é registrado |

## Etapas

### F6.1 — Bootstrap do `apps/web`

**Entrega:** SPA Vue servida por `pnpm dev`, com a casca de layout e as seis rotas do §3 navegáveis.

**Arquivos:** `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/tsconfig.json`, `apps/web/index.html`, `apps/web/src/main.ts`, `apps/web/src/App.vue`, `apps/web/src/router/index.ts`, `apps/web/src/layout/AppShell.vue`, `package.json` (raiz, script `dev`)

**Tarefas**

- [ ] Criar `apps/web` com Vite + Vue 3 + TypeScript strict, herdando o tsconfig base do monorepo (§4)
- [ ] Registrar PrimeVue como plugin com preset de tema e locale pt-BR; importar componente por componente, sem import global do pacote inteiro
- [ ] Configurar Pinia e Vue Router com as seis rotas do §3 (intake, fila, revisão, envio, histórico, notificações) e redirecionar `/` para a fila
- [ ] Montar a casca: navegação lateral, slot de banner global (pausa e gatilho 3+), área do badge de notificações e indicador de conexão SSE
- [ ] Configurar o proxy do Vite para as rotas da API, incluindo a de SSE (D3), com `changeOrigin` e sem buffering
- [ ] Criar o script `dev` na raiz subindo api + web em watch (CLAUDE.md: `pnpm dev` nasce aqui)
- [ ] Acrescentar um **terceiro projeto** ao `vitest.config.ts` (a F1 já o dividiu em `unidade` e `db`) para os testes de `apps/web` em ambiente jsdom, sem tocar no ambiente node dos outros dois
- [ ] Incluir `apps/web` em `pnpm lint` e `pnpm typecheck` sem exceção de regra

**Testes:** teste de fumaça montando `AppShell.vue` — existe para provar que o ambiente jsdom do vitest está de pé, não para travar comportamento.

**Pronto quando:** `pnpm dev` sobe os dois processos, a SPA renderiza a casca com as seis rotas navegáveis e console do browser sem erro; `pnpm lint`, `pnpm typecheck` e `pnpm test` verdes.

### F6.2 — Camada de dados: client REST, SSE com reconexão e fuso

**Entrega:** uma única forma de buscar dados, de reagir a mudança e de formatar data — usada por todas as telas seguintes.

**Arquivos:** `apps/web/src/api/client.ts`, `apps/web/src/api/*.ts` (um por recurso), `apps/web/src/composables/useSse.ts`, `apps/web/src/composables/useRecurso.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/stores/sistema.ts`

**Tarefas**

- [ ] Client HTTP fino com timeout, erro tipado (status + código de domínio) e tipos importados de `packages/shared` — nunca redeclarados no front (CLAUDE.md)
- [ ] `useSse` assina os quatro tópicos do §12 (`submissao.updated`, `run.updated`, `notificacao.created`, `sistema.pausa`) e, para cada evento, **dispara refetch** da rota correspondente; o payload do evento nunca vira estado (§10.22)
- [ ] Reconexão com backoff limitado; a cada `open` após queda, refetch completo das telas montadas
- [ ] Refetch também ao voltar de aba oculta (`visibilitychange`), que é o caso em que o `EventSource` fica "aberto" e morto
- [ ] Expor `status: conectado | reconectando | offline` e ligá-lo ao indicador da casca
- [ ] Helper único de data com `Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' })`, cobrindo data, data+hora e duração
- [ ] Store `sistema` com pausa global e status da conexão (D2)

**Testes:** `useSse` (evento dispara refetch da chave certa; queda e volta dispara refetch completo; payload jamais é aplicado no estado); helper de data com instante UTC fixo; guard que falha se `toLocale*` aparecer em qualquer arquivo de `apps/web/src` fora de `src/lib/data.ts`.

**Pronto quando:** com a API derrubada e religada, a UI volta sozinha ao estado correto sem reload manual, e o indicador percorre conectado → reconectando → conectado.

### F6.3 — Tela Intake (§9.1)

**Entrega:** colar um ou vários blocos, revisar o preview e iniciar o run, só pela UI.

**Arquivos:** `apps/web/src/views/IntakeView.vue`, `apps/web/src/components/intake/PreviewTabela.vue`, `apps/web/src/components/intake/ConfigRun.vue`

**Tarefas**

- [ ] Textarea de bloco colado enviado cru ao endpoint de preview da F5; o front não parseia nem revalida
- [ ] Tabela de preview editável com o resultado por linha: campos parseados, erro apontado no campo faltante (§10.23) e par sem skill marcado com dropdown de escolha manual (§10.3)
- [ ] Destacar na linha o aviso de duplicata de submissão ativa devolvido pela API (§9.1)
- [ ] Confirmar desabilitado enquanto houver linha inválida; a confirmação envia apenas as linhas confirmadas
- [ ] Config do run na mesma tela: modelo, `max_paralelo` (default 2, aviso visível acima de 2, teto 4 — §8) e política de revisão (§5)
- [ ] Botão iniciar desabilitado com explicação quando já existe run ativo (§10.21)
- [ ] Botão "Buscar desafios em aberto (FC)" presente, desabilitado, com aviso "aguardando integração" (§9.1 → F9)
- [ ] Conferir que `Celular:` colado no bloco não aparece em nenhuma coluna do preview (regra dura 6)

**Testes:** componente do preview — linha sem repositório mostra o erro no campo e mantém a confirmação travada; linha sem skill mostra o dropdown. Nenhum teste reimplementa o parser (é da F5, testado lá).

**Pronto quando:** colar os 5 blocos reais do aceite da F5 produz 5 linhas corretas no preview, e um bloco sem `Repositório:` aponta a linha e trava a confirmação.

### F6.4 — Tela Dashboard/Fila (§12)

**Entrega:** estado do sistema ao vivo — contadores, métricas, run ativo, pausa e alerta agregado.

**Arquivos:** `apps/web/src/views/FilaView.vue`, `apps/web/src/components/dashboard/*`

**Tarefas**

- [ ] Contadores por estado do §6, com célula para todos os estados (inclusive terminais e desvios)
- [ ] As outras três métricas do §12 lidas de `GET /api/metricas/dashboard` (F5.8): tempo médio de correção em 24h, taxa de aprovação por skill e gatilhos por tipo — exibir "sem dados" quando `gatilhos por tipo` vier vazio, que é o estado normal antes da F7
- [ ] Painel do run ativo lendo `GET /api/runs/:id`: modelo, `max_paralelo`, política de revisão, `runs.status` (§5), progresso (concluídas/total) e lista do que está em `corrigindo`
- [ ] Botões do ciclo de vida do run chamando `POST /api/runs/:id/{cancelar,pausar,retomar}` (transições humanas de `runs.status`, entregues por F4 e expostas pela F5; `finalizado` é automático e não tem botão), com confirmação, desabilitados quando o status atual não permite a transição e refetch de `GET /api/runs/:id` pelo evento `run.updated` (§10.22)
- [ ] Pausar/retomar global (§12), com o valor vindo de `config` e o banner de pausa na casca, visível em qualquer tela — pausa global e status do run são coisas distintas e não compartilham botão
- [ ] Banner de gatilho agregado 3+ (§10.27) com o tipo do gatilho e link para a lista filtrada, ligado ao endpoint de agregação da F7 e **oculto enquanto a rota devolver vazio** (D1)
- [ ] Atualização ao vivo via `useSse` (refetch, nunca patch de payload)

**Testes:** contador falha se algum estado do §6 não tiver rótulo (o teste percorre o enum de `packages/shared`); banner 3+ não renderiza quando a rota de agregação devolve lista vazia e renderiza com contagem ≥ 3; botão de transição de run desabilitado para status que não a permite.

**Pronto quando:** com um run em execução, os contadores acompanham as mudanças de estado sem reload; cancelar o run pelo painel muda `runs.status` para `cancelado` no banco; pausar reflete em `config` e o banner de pausa aparece em todas as telas.

### F6.5 — Tela Revisão (§9.3)

**Entrega:** revisar, editar e decidir sobre uma devolutiva sem sair da tela.

**Arquivos:** `apps/web/src/views/RevisaoView.vue`, `apps/web/src/components/revisao/CardRevisao.vue`, `apps/web/src/components/revisao/DossieSecoes.vue`

**Tarefas**

- [ ] Lista das submissões em `aguardando_revisao`, com veredito `inconclusivo` destacado e `motivo_inconclusivo` visível (§10.8)
- [ ] Card do §9.3: veredito, editor de `texto_final` e `texto_agente` somente-leitura ao lado (regra dura 7 — nenhuma requisição do front envia `texto_agente`)
- [ ] Dossiê expandível por seção — execução, critérios com evidência, dúvidas, delta base; seção ausente (ex.: `delta_base` null) não vira seção vazia
- [ ] Badges dos gatilhos de `correcoes.gatilhos`, incluindo `historico_nao_avaliado` (§10.17)
- [ ] Link para o transcript apontando `GET /api/correcoes/:id/transcript` (F5.8); o front nunca monta nem envia caminho de arquivo
- [ ] Ações do §6 com confirmação: aprovar para envio (podendo trocar o veredito), reprocessar e cancelar
- [ ] Timeline de `eventos` da submissão dentro do card (§12)

**Testes:** o card renderiza apenas as seções presentes do dossiê; aprovar envia `texto_final` e `veredito_final` e nunca `texto_agente`.

**Pronto quando:** editar o texto, trocar o veredito e aprovar leva a submissão para `pronta_envio`, e um `SELECT texto_agente` no banco devolve o mesmo valor de antes da edição.

### F6.6 — Tela Prontas para envio (§9.4)

**Entrega:** fechar o ciclo de uma submissão com dois cliques, incluindo o caso de link inválido.

**Arquivos:** `apps/web/src/views/EnvioView.vue`, `apps/web/src/components/envio/*`

**Tarefas**

- [ ] Lista de `pronta_envio` com o texto final visível na íntegra
- [ ] "Copiar devolutiva" (texto puro) com confirmação visual e fallback para contexto não-seguro (ver Riscos)
- [ ] "Marcar como enviada" → `enviada` (§6), com a linha saindo da lista pelo refetch
- [ ] Seção própria de `link_invalido` com o par "copiar devolutiva padrão e marcar enviada" (§6, §10.1–2), exibindo o motivo que entrou no texto
- [ ] Nenhuma ação de envio automático na UI: origem `fc_platform` não aparece nesta fase (F9)

**Testes:** a ação de copiar usa `texto_final` (não o rascunho); item de `link_invalido` dispara a transição própria, não a de `pronta_envio`.

**Pronto quando:** uma submissão sai de `pronta_envio` para `enviada` só com o mouse, com linha correspondente em `eventos`, e o texto colado em um editor externo é idêntico ao `texto_final`.

### F6.7 — Tela Histórico

**Entrega:** consulta de tudo que já passou pelo sistema, com filtros e detalhe por submissão.

**Arquivos:** `apps/web/src/views/HistoricoView.vue`, `apps/web/src/components/historico/*`

**Tarefas**

- [ ] DataTable do PrimeVue com aluno, projeto/fase, skill, estado, veredito final, tentativa do aluno e data de envio (fuso do helper da F6.2)
- [ ] Filtros por estado, skill, aluno e período aplicados no servidor (D5) e refletidos na URL, para que recarregar preserve a consulta
- [ ] Ordenação e paginação server-side coerentes com o filtro — nunca filtrar no cliente sobre página parcial
- [ ] Abrir uma linha mostra as correções da submissão (inclusive as anteriores) e as devolutivas históricas (§5: reprocessar cria nova linha e a anterior permanece)
- [ ] Exibir `cancelada` e `substituida` com o `status_detalhe` como motivo

**Testes:** função pura que monta os query params — período escolhido em America/Sao_Paulo vira intervalo UTC correto nas duas bordas do dia.

**Pronto quando:** filtrar por skill + período devolve o mesmo conjunto que a consulta equivalente no banco, e recarregar a página com a URL filtrada mantém o filtro.

### F6.8 — Notificações (§12)

**Entrega:** o operador é avisado sem precisar ficar olhando a fila.

**Arquivos:** `apps/web/src/views/NotificacoesView.vue`, `apps/web/src/components/NotificacoesBadge.vue`, `apps/web/src/stores/notificacoes.ts`

**Tarefas**

- [ ] Badge na casca com a contagem de não lidas, alimentado por `notificacao.created` via refetch
- [ ] Lista com tipo, texto, data no fuso correto e link que leva à submissão ou tela de origem (§5)
- [ ] Marcar como lida (individual e todas), persistido pela API
- [ ] Conferir que os três geradores já existentes chegam com texto acionável: `sem_skill` e `erro` (§6) e pausa automática por limite de plano/credencial (§10.10–11)

**Testes:** o badge reflete a contagem devolvida pelo servidor após o refetch, e não um contador incrementado localmente.

**Pronto quando:** provocar um `sem_skill` (par projeto+fase inexistente no intake) faz o badge subir sem reload, e o link abre a submissão certa.

### F6.9 — Fechamento: demo fim a fim e bordas da UI

**Entrega:** o fluxo do aceite roda inteiro só com o mouse, e a UI se comporta quando não há dados ou a API falha.

**Arquivos:** os das etapas anteriores + `apps/web/src/components/EstadoVazio.vue`

**Tarefas**

- [ ] Estado vazio em cada lista (fila, revisão, envio, histórico, notificações) dizendo qual é o próximo passo
- [ ] Erro de API nunca deixa tela em branco: mensagem + botão "tentar de novo" que refaz o fetch
- [ ] Listas que atualizam por SSE não "pulam" de layout durante o refetch
- [ ] Varredura do §6: toda transição de responsabilidade humana tem exatamente um caminho na UI, e nenhuma transição de máquina (API/Worker) é oferecida como botão
- [ ] Passada completa do roteiro do aceite A9 sem terminal aberto, anotando cada trava encontrada

**Testes:** nenhum novo — esta etapa é a verificação do conjunto (ver Critérios de aceite).

**Pronto quando:** o roteiro do aceite A9 é executado do começo ao fim sem tocar no terminal.

## Edge cases do §10 cobertos aqui

| # | Caso | Como esta fase trata | Onde é verificado |
|---|---|---|---|
| 1, 2 | Repo inacessível / link do repo base | Seção própria em Prontas para envio, com o par "copiar devolutiva padrão + marcar enviada" (F6.6) | A6 |
| 3 | (projeto, fase) sem skill | Linha marcada no preview com dropdown de skill (F6.3) + notificação (F6.8) | A2, A8 |
| 5 | Nova entrega com a anterior ativa | Só exibição: a linha sai da fila e aparece como `substituida` no histórico; a regra é do backend (F4) | A7 |
| 8 | Veredito `inconclusivo` | Card destacado na Revisão com `motivo_inconclusivo` visível (F6.5) | A5 |
| 17 | `historico_nao_avaliado` | Badge de gatilho no card + campo do dossiê (F6.5) | A5 |
| 21 | 2º run com um ativo | Botão iniciar desabilitado com explicação, não escondido (F6.3) | A2 |
| 22 | SSE cai | Reconexão com backoff + refetch completo; indicador de conexão (F6.2) | A3 |
| 23 | Bloco colado incompleto/malformado | Preview aponta o campo faltante na linha e trava a confirmação (F6.3) | A2 |
| 24, 25, 26 | Gatilhos de similaridade, tamanho e coerência | Badges no card de revisão; a UI não recalcula gatilho, só exibe o que veio em `correcoes.gatilhos` | A5 |
| 27 | 3+ correções com o mesmo gatilho | Componente de banner no dashboard com link para a lista filtrada, ligado ao endpoint de agregação e oculto enquanto ele devolver vazio (F6.4, D1) | Aceite da F7 (a agregação que faz o banner aparecer é de lá) |
| 10, 11 | Limite de plano / credencial | Banner global de pausa + notificação com texto acionável + botão retomar (F6.4, F6.8) | A4, A8 |

## Critérios de aceite

**Esta seção é a fonte da verdade do "pronto" desta fase** (o §13 do plano aponta para cá).

| # | Critério | Como provar | Evidência esperada |
|---|---|---|---|
| A1 | SPA de pé pelo comando do monorepo | `pnpm dev` e abrir a URL do Vite | Casca renderizada, seis rotas navegáveis, console do browser sem erro |
| A2 | Intake completo | Colar 2 blocos (um válido, um sem `Repositório:`) com um run ativo | Linha inválida apontada no campo; confirmar travado; botão iniciar desabilitado com explicação (§10.21); botão FC desabilitado com aviso |
| A3 | SSE cai e volta (§10.22) | Parar o processo da API durante um run e subir de novo | Indicador vai a "reconectando" e volta; após reconectar, a tela bate com `GET` da rota correspondente **sem reload manual** |
| A4 | Dashboard, run ativo e pausa | Comparar contadores com `SELECT status, count(*) FROM submissoes GROUP BY 1`; cancelar o run pelo painel; clicar pausar | Contadores idênticos; as 4 métricas do §12 exibidas, com `gatilhos por tipo` podendo aparecer zerado enquanto a F7 não popular `correcoes.gatilhos`; `runs.status` = `cancelado` no banco após o botão; `config.pausa_global` alterada e banner de pausa em todas as telas |
| A5 | Revisão com autoridade humana | Editar o texto, trocar o veredito e aprovar; consultar o banco antes e depois | Submissão em `pronta_envio`; `texto_final` e `veredito_final` atualizados; `texto_agente` byte a byte idêntico; evento registrado |
| A6 | Envio manual (§9.4) | "Copiar devolutiva" + "marcar como enviada" numa submissão e no item `link_invalido` | Texto colado em editor externo idêntico ao `texto_final`; estado `enviada` pelas duas transições do §6; linhas em `eventos` |
| A7 | Histórico com filtros e fuso | Filtrar por skill + período e recarregar a página com a URL filtrada | Conjunto igual ao da consulta equivalente no banco; data de envio exibida em America/Sao_Paulo (conferida contra o timestamp UTC da linha) |
| A8 | Notificações | Provocar `sem_skill` pelo intake | Badge sobe sem reload; item na lista com link que abre a submissão; marcar lida persiste após refresh |
| A9 | Demo fim a fim só com o mouse (§9.1, §9.3, §9.4 — a meta 1 do §1 posta à prova) | Colar blocos → iniciar → acompanhar ao vivo → revisar/editar → enviar → conferir no histórico | Roteiro inteiro sem abrir terminal nem devtools, com registro (gravação ou passo a passo com evidência) |
| A10 | Higiene do monorepo | `pnpm lint && pnpm typecheck && pnpm test` | Verdes com `apps/web` no workspace |

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

## Testes que nascem nesta fase

- `useSse`: evento conhecido dispara refetch da rota certa; payload do evento nunca é aplicado no estado; queda e volta de conexão disparam refetch completo; backoff não martela o servidor (relógio falso, sem `sleep`).
- Helper de data: instante UTC fixo formatado em America/Sao_Paulo, incluindo virada de dia; e guard textual que falha se `toLocaleString`/`toLocaleDateString`/`toLocaleTimeString` aparecer em `apps/web/src` fora de `src/lib/data.ts`.
- Rótulos de estado: percorre o enum de estados do §6 vindo de `packages/shared` e falha se algum não tiver rótulo e severidade de badge — estado novo no domínio quebra o front na hora, não em produção.
- Client REST: resposta de erro vira erro tipado tratado pela tela, não exceção solta.
- Preview do intake: linha com campo faltante mantém a confirmação travada; linha sem skill oferece o dropdown.
- Card de revisão: renderiza só as seções presentes do dossiê; a submissão de aprovação não carrega `texto_agente`.
- Filtros do histórico: função pura de query params, com período em America/Sao_Paulo convertido para intervalo UTC correto nas bordas do dia.
- Notificações: contagem do badge vem do servidor após refetch, não de incremento local.
- Banner de gatilho agregado: rota devolvendo lista vazia não renderiza banner nenhum (é o estado normal até a F7); contagem ≥ 3 renderiza com o tipo do gatilho.

## Riscos e armadilhas

- **Duplicar regra de domínio no front.** Sinal de alerta: o cliente decidindo transição (`if (status === 'corrigindo') …`) em vez de exibir, ou revalidando o bloco colado. Isso cria a segunda versão da verdade que o CLAUDE.md manda evitar — parser, validação e política são da API.
- **SSE atrás do proxy do Vite.** Buffering faz os eventos chegarem em lote e mascara o comportamento real; sinal: a tela "acorda" de repente. Conferir sem cabeçalho de compressão e testar também sem proxy antes de fechar a fase.
- **`EventSource` "aberto" e morto.** Aba em background ou queda silenciosa da API não geram `error` imediato. Sem heartbeat do servidor, a UI mente. Se a rota SSE da F5 não enviar ping periódico, isso é delta para a API — registrar, não improvisar timeout mágico no cliente.
- **Fuso.** `new Date(x).toLocaleString('pt-BR')` usa o fuso do sistema operacional; em WSL o TZ costuma estar em UTC e a data errada passa despercebida. Só o helper com `timeZone` explícito, e o guard textual acima é o que impede a reincidência.
- **Clipboard exige contexto seguro.** `http://localhost` é seguro; `http://<ip-da-máquina>` não é, e a cópia falha em silêncio se a demo for aberta de outro dispositivo. Fallback com textarea + seleção, e confirmação visual sempre.
- **Filtro client-side em DataTable paginado** filtra só a página carregada e devolve resultado errado com cara de certo (D5). **Node/pnpm fora do PATH em shell não-interativo** (`docs/STATUS.md`) derruba qualquer script que chame `pnpm dev` sem carregar o nvm.
- **A demo depende de correção real.** Sem `CLAUDE_CODE_OAUTH_TOKEN` válido e sem golden repo, "acompanhar ao vivo" vira mock e o aceite A9 não vale nada. É pré-condição, não detalhe.
- **Scope creep de UI** — tema escuro, animação, gráfico bonito, atalho de teclado. Nada disso está no §12 nem no §13; o destino é F8. Risco do §15 que a fase toca: máquina única (WSL) — suspensão no meio da demo derruba o run (§10.28) e a culpa parece do front.

## O que NÃO entra nesta fase

- Gatilhos programáticos e a query de agregação 3+ → F7 (aqui só o componente que os exibe, oculto enquanto a rota devolver vazio — D1); as provas do banner são do aceite da F7, não desta fase
- Endpoint de métricas do dashboard e rota de transcript → F5 (F5.8); a F6 só consome, e rota faltando volta para a F5 em vez de virar cálculo no cliente
- Suite E2E com golden repos, backup e `docs/runbook.md` → F7
- Login, multiusuário, deploy web, métricas avançadas, exportação, tema → F8
- Botão "Buscar desafios em aberto (FC)" funcional e envio automático por driver → F9 (nasce desabilitado aqui, §9.1)
- Edição de `texto_agente` → nunca (regra dura 7); a UI edita `texto_final`
- Estado ou transição fora do §6 → o plano muda primeiro (regra dura 3); a UI não inventa ação
- Testes de browser (Playwright/Cypress) → fora do plano; se virarem necessidade, viram decisão registrada (D4)
- Reimplementar parser ou validação de bloco no cliente → é da F5, em `packages/shared`

## Impacto em fases seguintes

A preencher no encerramento da fase.

| O que mudou aqui | Fase afetada | O que foi atualizado lá |
|---|---|---|

## Registro de execução

A preencher durante a fase.

- **Iniciada em:** AAAA-MM-DD
- **Concluída em:** AAAA-MM-DD
- **Decisões tomadas:** (D1–D5 resolvidas, com link para `docs/STATUS.md` / Apêndice B quando arquitetural)
- **Divergências do plano:** (o que divergiu, por quê, e onde foi registrado)
- **Evidência dos aceites:** (saída de comando, resultado de teste, registro da demo A9)
