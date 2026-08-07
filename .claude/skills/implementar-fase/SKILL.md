---
name: implementar-fase
description: Implementa uma fase do plano de desenvolvimento do projeto Banca (docs/fases/) do início ao encerramento, com verificação de pré-condições, critérios de aceite executados de verdade, marcação de progresso e revisão de impacto nas fases seguintes. Use esta skill SEMPRE que o usuário pedir para implementar, desenvolver, fazer, continuar, retomar, avançar ou finalizar uma fase — em qualquer formulação: "implementa a fase 1", "bora pra F2", "termina a F3", "vamos para a próxima fase", "continua o desenvolvimento", "continua de onde paramos", "faz os spikes da F0" — mesmo que a palavra "fase" não apareça. Se o pedido é escrever código de produção deste projeto que corresponde a uma fase de `docs/fases/`, esta skill se aplica.
---

# Implementar fase

Cada fase tem um arquivo próprio em `docs/fases/F<n>-<slug>.md`. Esse arquivo é o **dono das tarefas
e dos critérios de aceite**; o `docs/project-plan.md` continua sendo o dono da **arquitetura e da
intenção**, e o §13 dele é só o índice que aponta para cá.

Esta skill define como transformar um arquivo de fase em código sem perder as decisões já tomadas,
como registrar o progresso para a próxima sessão saber onde parou, e como impedir que o que você
descobrir hoje deixe as fases seguintes desatualizadas em silêncio.

## Antes de escrever qualquer código (nesta ordem)

1. Leia `docs/STATUS.md` — onde paramos, decisões recentes, observações e armadilhas já descobertas.
2. Leia `docs/fases/README.md` — o índice: qual fase está em que estado, o que destrava o quê.
3. Leia **o arquivo da fase** por inteiro. Ele traz objetivo, pré-condições, etapas com tarefas,
   aceites, edge cases, riscos e escopo negativo. As tarefas e os aceites viram sua todo list.
4. Leia as seções do plano que o arquivo referencia no cabeçalho (ex.: F1 → §5; F2 → §8; F4 → §6).
   Não implemente de memória: o plano passou por revisão e contém decisões deliberadas que memória
   resume errado. O Apêndice B registra contradições já resolvidas — desfazê-las por descuido é
   reintroduzir bug de arquitetura.
5. **Rode a checklist de pré-condições do arquivo da fase, item por item, de verdade.** Fase anterior
   marcada ✅ no índice? Pendência humana do §17 resolvida (CSV do skills_map, golden repos, token,
   `.wslconfig`)? Se faltar algo, pare e pergunte ao usuário — não invente um substituto.
6. Resolva a seção **"Decisões a tomar nesta fase"** antes de começar: são perguntas que o plano não
   respondeu. Apresente a recomendação ao usuário e decida com ele. Decisão tomada em silêncio no meio
   da implementação é a que ninguém revisa.
7. Marque a fase como `⏳ em andamento (iniciada AAAA-MM-DD)` no arquivo da fase e no índice antes de
   começar. Se a sessão cair no meio, é isso que a próxima instância vai ler.

## Como implementar

- Incremental: uma fatia vertical funcionando e testada vale mais que todas as entregas pela metade.
  As etapas do arquivo já estão em ordem executável — siga-a, e **marque `[x]` cada tarefa assim que
  ela estiver pronta e verificada**, não no fim. O arquivo da fase é o mapa de retomada: uma sessão
  nova tem que conseguir continuar lendo só ele.
- A cada etapa pronta, avise o usuário que dá para commitar — commit e push só a pedido dele, pela
  skill `commit-e-push` (regra dura 9 do CLAUDE.md). Quando ele pedir, o resultado são commits
  pequenos e atômicos, não um commitzão no fim da fase.
- Testes nascem junto com o código que testam — nunca "depois". Critérios na seção **Testes** abaixo.
- Boas práticas por tecnologia deste projeto:
  - **NestJS**: toda entrada HTTP validada por DTO; controllers sem lógica; services finos; erros de
    domínio como exceções tipadas mapeadas por exception filter (nunca `throw new Error("...")`
    atravessando a API).
  - **Prisma**: toda mudança de schema via migration; quando estado da submissão e fila mudam juntos,
    mesma transação (é o motivo de usarmos pg-boss sobre o mesmo Postgres).
  - **pg-boss**: handlers idempotentes — todo job pode executar duas vezes; escreva assumindo isso.
    Timeout definido em todo job.
  - **Vue**: lógica compartilhada em composables; estado vindo do servidor flui por fetch + SSE, não
    duplicado em store sem necessidade.
  - **Fronteiras externas** (Docker, git, `claude` CLI, rede): timeout em toda chamada, erro tratado e
    logado com `job_id`/`submissao_id`, falha esperada nunca vira exceção não tratada. Prefira
    `execFile` a `exec` — argumento de shell interpolado com dado externo (URL de repo, nome de aluno)
    é injeção esperando para acontecer.
- Segurança: valide todo input externo (bloco colado do intake, payload de webhook); segredos só via
  `.env`; toda criação Docker carrega label `fc.job=<id>`/prefixo `fc-job-`; releia as "Regras duras"
  do CLAUDE.md antes de tocar em Docker, banco ou segredos.
- Edge cases: a tabela "Edge cases do §10 cobertos aqui" já lista os que tocam a fase; cada um vira
  teste ou verificação explícita. Caso de fase futura que aparecer no caminho: registre no arquivo
  daquela fase e no STATUS.md, não trate silenciosamente.
- Escopo: a seção "O que NÃO entra nesta fase" é vinculante. Vontade de adiantar algo → anote no
  arquivo da fase de destino e siga.
- Divergência descoberta durante a implementação: **arquitetura muda no plano primeiro** (com o porquê
  no Apêndice B), depois no arquivo da fase, depois no código. Tarefa ou aceite que se mostrou errado
  muda direto no arquivo da fase, com a razão no "Registro de execução". Plano, arquivo de fase e
  código nunca contam histórias diferentes.

## Testes (backend)

Toda feature do backend nasce coberta por testes — feature sem teste é feature incompleta, e o
Definition of Done não fecha. Mas a régua tem dois lados: o vício de não testar e o vício de gerar
dezenas de testes triviais que só ocupam espaço e custam manutenção. O critério é: **teste
comportamento e contrato, não implementação.**

O que merece teste:

- Lógica de domínio e regras: máquina de estados (a tabela do §6 vira tabela de testes), parser de
  bloco, validador do dossiê, gatilhos programáticos — unidade pura, sem mock de nada.
- Fronteiras HTTP: por endpoint, validação de DTO, códigos de resposta, contrato de erro.
- Handlers de fila: idempotência (rodar duas vezes não corrompe), timeout, comportamento sob retry.
- Caminhos de erro com o mesmo carinho do caminho feliz — os edge cases do §10 que tocam a fase viram
  testes nomeados pelo cenário.

O que NÃO escrever:

- Teste que só reafirma o mock (mockou X retornando Y, verifica que retorna Y — não testa nada).
- Getter/setter, mapeamento trivial do Prisma, comportamento do framework (que o Nest injeta
  dependência, que o decorator existe).
- Snapshot grande sem intenção declarada.
- Teste unitário duplicando o que um teste de integração da mesma fase já cobre melhor.

Como escrever:

- Nome descreve o comportamento em linguagem de domínio: `submissão duplicada durante corrigindo →
  anterior vira substituida e runner é morto`. Um comportamento por teste, estrutura
  arrange-act-assert.
- Mock apenas nas fronteiras externas (Docker, git, `claude` CLI, relógio); o domínio roda de verdade.
  Integração usa o Postgres do compose de dev.
- Determinístico: sem `sleep`, sem dependência de ordem de execução, relógio injetável quando tempo
  importa.
- Sinal de teste ruim: quebra a cada refatoração que não muda comportamento — está testando
  implementação; reescreva ou apague.
- Cobertura numérica não é o alvo e não há meta de %. O alvo: todo comportamento que pode quebrar tem
  um teste que quebra junto.

## O plano não é infalível — seu olhar crítico é parte do trabalho

O plano e os arquivos de fase foram escritos antes da primeira linha de código. Quem está com o código
real na frente é você — e certamente existem cenários, riscos e melhorias que ninguém previu ali. Faz
parte da obrigação de quem implementa:

- Enquanto trabalha, avalie ativamente: este desenho ainda faz sentido agora que o código existe?
  Apareceu um edge case que o §10 não lista? Há um risco, uma simplificação ou uma oportunidade que
  ninguém enxergou?
- Não siga o plano cegamente quando a realidade mostrar problema — mas também não "corrija" em
  silêncio. O caminho depende do tipo de achado:
  - **Impede ou contradiz a fase atual** → pare, traga ao usuário, atualize plano/arquivo de fase e só
    então implemente (a regra de divergência acima).
  - **Não bloqueia** (melhoria, risco futuro, cenário novo, ideia) → registre em "Observações para o
    usuário" no `docs/STATUS.md` e apresente no resumo final. Não implemente sem combinar: melhoria
    não combinada é scope creep, por melhor que pareça.
- Achado silencioso é achado perdido: o usuário só fica sabendo do que você contar explicitamente.

## Comentários no código

Código autoexplicativo com bons nomes, quase sem comentários. Comentário só quando responde um "por
quê" que o código não consegue dizer: decisão de design, workaround com contexto, referência a uma
seção do plano (ex.: `// plan §6: substituida mata o runner em voo`).

Nunca: comentário narrando o que a linha obviamente faz; docblock decorativo em todo método;
cabeçalhos/separadores ASCII; TODO solto sem registro correspondente no STATUS.md.

## Definição de pronto

Antes de declarar a fase concluída:

1. Todos os critérios de aceite do arquivo da fase **executados de verdade** — rode os comandos,
   provoque os cenários, não suponha. Guarde a evidência (saída de comando, resultado de teste): ela
   vai para o "Registro de execução" e para o resumo final.
2. Todas as tarefas das etapas marcadas `[x]`, ou explicitamente movidas para outra fase com registro.
3. `pnpm lint` e `pnpm test` verdes (`pnpm test` inclui o guard de coerência da documentação).
4. Nenhum código comentado, arquivo morto ou TODO sem registro deixado para trás.

## Revisão de impacto nas fases seguintes (obrigatória)

Uma fase quase nunca termina exatamente como foi escrita. O que você decidiu, renomeou, adiou ou
descobriu aqui frequentemente invalida uma premissa de uma fase lá na frente — e essa fase vai ser
implementada por uma sessão que não viveu esta. Manter a doc coerente é entrega da fase, não cortesia.

Faça isso **antes** de marcar a fase como concluída:

1. **Liste o delta.** O que ficou diferente do previsto:
   - decisões resolvidas na seção "Decisões a tomar nesta fase";
   - divergências do plano e do próprio arquivo da fase;
   - contratos compartilhados criados ou alterados (tipos de `packages/shared`, `dossie.schema.json`,
     nomes de tabela/campo/enum, formato do job dir, nome de comando);
   - localização de código diferente da assumida (onde nasceu o pacote, onde mora o schema);
   - biblioteca, script de `package.json` ou variável de ambiente nova;
   - entrega antecipada de outra fase, ou adiada para outra;
   - edge case, risco ou armadilha descoberto na prática.
2. **Para cada item, abra os arquivos das fases seguintes e procure onde ele aparece** — pré-condições,
   tarefas de etapa, tabela de aceite, "Depende de"/"Destrava", "O que NÃO entra nesta fase". Busque
   pelo nome do artefato, não pela lembrança do que estava escrito.
3. **Atualize lá mesmo, no arquivo da fase afetada.** Se a fase antecipou uma entrega, remova-a de lá
   e diga de onde ela veio. Se criou uma pré-condição nova, escreva-a. Não deixe "avisar depois".
4. **Se o impacto for arquitetural, o plano vem primeiro**: `docs/project-plan.md` (com o porquê no
   Apêndice B), depois os arquivos de fase, depois o índice.
5. **Preencha a tabela "Impacto em fases seguintes"** do arquivo da fase atual: o que mudou, qual fase
   foi afetada, o que foi atualizado lá. Tabela vazia é resposta válida — mas só depois de ter
   procurado; escreva `Nenhum impacto identificado nas fases seguintes.` em vez de deixar em branco.
6. **Rode `pnpm test`.** O guard `tests/fases.test.ts` verifica que os marcadores de status batem entre
   o arquivo da fase, o índice e o §13, e que a estrutura dos arquivos continua íntegra. Incoerência de
   documentação neste repo quebra o build, como qualquer outro bug.

## Encerramento da fase (obrigatório, nesta ordem)

1. **Renomeie o arquivo da fase**, acrescentando o sufixo `-concluida` antes da extensão:

   `docs/fases/F1-banco-e-dominio.md` → `docs/fases/F1-banco-e-dominio-concluida.md`

   Use `git mv` (o arquivo já é versionado; assim o histórico segue o arquivo e o diff mostra um
   rename, não um delete + create). O sufixo existe para que um `ls docs/fases/` conte o estado do
   projeto sem abrir nada. Só a fase **implementada** é renomeada: `⬜` e `⏳` mantêm o nome original,
   para que cada fase seja renomeada uma vez só, no fim.

2. **Marque a fase como concluída nos três lugares**, com a data de hoje:
   - `docs/fases/F<n>-<slug>-concluida.md`, na linha de status do cabeçalho:
     `> **Status:** ✅ implementada em 2026-08-07`
   - `docs/fases/README.md`, na linha da fase na tabela do índice — status **e o link**, que agora
     aponta para o arquivo renomeado.
   - `docs/project-plan.md` §13, no título da fase e no link **Plano executável**:
     `### F1 — Banco e domínio (1–2d) ✅ implementada em 2026-08-07`

   Confira também se `docs/STATUS.md` ou algum outro arquivo de fase cita o nome antigo:
   `grep -rn 'F<n>-<slug>\.md' --include='*.md' .` tem que voltar vazio.

   Se a sessão terminar com a fase incompleta, **não renomeie**: marque
   `⏳ em andamento (iniciada AAAA-MM-DD)` nos três lugares e detalhe o ponto exato de parada no
   STATUS.md. É essa marcação que faz qualquer nova instância do Claude Code saber onde o projeto está.

   `pnpm test` valida os quatro lugares de uma vez: o guard exige que o sufixo do nome do arquivo e o
   marcador de status digam a mesma coisa, e que os links do índice e do §13 apontem para o arquivo
   que de fato existe. Renomear sem fechar a fase quebra tanto quanto fechar sem renomear.

3. Preencha o **"Registro de execução"** do arquivo da fase: datas, decisões tomadas, divergências e
   onde foram registradas, evidência de cada aceite.

4. Atualize `docs/STATUS.md`: feito, em andamento, próximo passo, decisões da fase — e "Observações
   para o usuário" com o que você identificou que o plano não previu.

5. Resumo final para o usuário: o que foi entregue, evidência de cada aceite, o que ficou de fora e
   por quê, **quais fases seguintes foram atualizadas e por quê**, e as observações e pontos de
   melhoria identificados. Não os deixe apenas no arquivo: apresente-os na conversa.
