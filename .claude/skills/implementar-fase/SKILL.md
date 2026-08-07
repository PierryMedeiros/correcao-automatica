---
name: implementar-fase
description: Implementa uma fase do plano de desenvolvimento do projeto Banca (docs/project-plan.md, §13) do início ao encerramento, com verificação de pré-condições, critérios de aceite executados de verdade e marcação de progresso no plano. Use esta skill SEMPRE que o usuário pedir para implementar, desenvolver, fazer, continuar, retomar, avançar ou finalizar uma fase — em qualquer formulação: "implementa a fase 1", "bora pra F2", "termina a F3", "vamos para a próxima fase", "continua o desenvolvimento", "continua de onde paramos", "faz os spikes da F0" — mesmo que a palavra "fase" não apareça. Se o pedido é escrever código de produção deste projeto que corresponde a entregas do §13 do plano, esta skill se aplica.
---

# Implementar fase

Uma fase só existe no `docs/project-plan.md` (§13). Esta skill define como transformá-la em código sem perder as decisões que o plano já tomou — e como registrar o progresso para que a próxima sessão saiba exatamente onde parou.

## Antes de escrever qualquer código (nesta ordem)

1. Leia `docs/STATUS.md` — onde paramos, decisões recentes.
2. Leia a fase no `docs/project-plan.md` §13: objetivo, entregas, critérios de aceite. Os aceites são a definição de pronto — copie-os para sua todo list como itens de verificação final.
3. Leia as seções do plano que a fase referencia (ex.: F1 → §5; F2 → §8; F4 → §6). Não implemente de memória: o plano passou por revisão e contém decisões deliberadas que memória resume errado.
4. Verifique pré-condições: a fase anterior está marcada como implementada no plano? Alguma pendência humana do §17 destrava esta fase (CSV do skills_map, golden repos, token, .wslconfig)? Se faltar algo de que a fase depende, pare e pergunte ao usuário — não invente um substituto.
5. Só então monte o plano da fase: entregas viram tarefas, aceites viram a checklist de encerramento.

## Como implementar

- Incremental: uma fatia vertical funcionando e testada vale mais que todas as entregas pela metade. A cada fatia pronta, avise o usuário que dá para commitar — commit e push só a pedido dele, pela skill `commit-e-push` (regra dura 9 do CLAUDE.md). Quando ele pedir, o resultado são commits pequenos e atômicos, não um commitzão no fim da fase.
- Testes nascem junto com o código que testam — nunca "depois". Critérios de qualidade na seção **Testes** abaixo.
- Boas práticas por tecnologia deste projeto:
  - **NestJS**: toda entrada HTTP validada por DTO; controllers sem lógica; services finos; erros de domínio como exceções tipadas mapeadas por exception filter (nunca `throw new Error("...")` atravessando a API).
  - **Prisma**: toda mudança de schema via migration; quando estado da submissão e fila mudam juntos, mesma transação (é o motivo de usarmos pg-boss sobre o mesmo Postgres).
  - **pg-boss**: handlers idempotentes — todo job pode executar duas vezes; escreva assumindo isso. Timeout definido em todo job.
  - **Vue**: lógica compartilhada em composables; estado vindo do servidor flui por fetch + SSE, não duplicado em store sem necessidade.
  - **Fronteiras externas** (Docker, git, `claude` CLI, rede): timeout em toda chamada, erro tratado e logado com `job_id`/`submissao_id`, falha esperada nunca vira exceção não tratada. Prefira `execFile` a `exec` — argumento de shell interpolado com dado externo (URL de repo, nome de aluno) é injeção esperando para acontecer.
- Segurança: valide todo input externo (bloco colado do intake, payload de webhook); segredos só via `.env`; toda criação Docker carrega label `fc.job=<id>`/prefixo `fc-job-`; releia as "Regras duras" do CLAUDE.md antes de tocar em Docker, banco ou segredos.
- Edge cases: varra o §10 do plano e liste os casos que tocam esta fase; cada um vira teste ou verificação explícita na implementação. Caso de fase futura que aparecer no caminho: registre no STATUS.md, não trate silenciosamente.
- Escopo: implemente somente a fase atual. Vontade de adiantar algo da próxima fase → anote no STATUS.md e siga.
- Divergência do plano descoberta durante a implementação: pare, atualize o `project-plan.md` (com o porquê no Apêndice B) e só então implemente. Plano e código nunca contam histórias diferentes.

## Testes (backend)

Toda feature do backend nasce coberta por testes — feature sem teste é feature incompleta, e o Definition of Done não fecha. Mas a régua tem dois lados: o vício de não testar e o vício de gerar dezenas de testes triviais que só ocupam espaço e custam manutenção. O critério é: **teste comportamento e contrato, não implementação.**

O que merece teste:

- Lógica de domínio e regras: máquina de estados (a tabela do §6 vira tabela de testes), parser de bloco, validador do dossiê, gatilhos programáticos — unidade pura, sem mock de nada.
- Fronteiras HTTP: por endpoint, validação de DTO, códigos de resposta, contrato de erro.
- Handlers de fila: idempotência (rodar duas vezes não corrompe), timeout, comportamento sob retry.
- Caminhos de erro com o mesmo carinho do caminho feliz — os edge cases do §10 que tocam a fase viram testes nomeados pelo cenário.

O que NÃO escrever:

- Teste que só reafirma o mock (mockou X retornando Y, verifica que retorna Y — não testa nada).
- Getter/setter, mapeamento trivial do Prisma, comportamento do framework (que o Nest injeta dependência, que o decorator existe).
- Snapshot grande sem intenção declarada.
- Teste unitário duplicando o que um teste de integração da mesma fase já cobre melhor.

Como escrever:

- Nome descreve o comportamento em linguagem de domínio: `submissão duplicada durante corrigindo → anterior vira substituida e runner é morto`. Um comportamento por teste, estrutura arrange-act-assert.
- Mock apenas nas fronteiras externas (Docker, git, `claude` CLI, relógio); o domínio roda de verdade. Integração usa o Postgres do compose de dev.
- Determinístico: sem `sleep`, sem dependência de ordem de execução, relógio injetável quando tempo importa.
- Sinal de teste ruim: quebra a cada refatoração que não muda comportamento — está testando implementação; reescreva ou apague.
- Cobertura numérica não é o alvo e não há meta de %. O alvo: todo comportamento que pode quebrar tem um teste que quebra junto.

## O plano não é infalível — seu olhar crítico é parte do trabalho

O plano foi escrito no dia 0, antes da primeira linha de código. Quem está com o código real na frente é você — e certamente existem cenários, riscos e melhorias que ninguém previu ali. Faz parte da obrigação de quem implementa:

- Enquanto trabalha na fase, avalie ativamente: este desenho ainda faz sentido agora que o código existe? Apareceu um edge case que o §10 não lista? Há um risco, uma simplificação ou uma oportunidade que o plano não enxergou?
- Não siga o plano cegamente quando a realidade mostrar problema — mas também não "corrija" em silêncio. O caminho depende do tipo de achado:
  - **Impede ou contradiz a fase atual** → pare, traga ao usuário, atualize o plano (Apêndice B) e só então implemente (a regra de divergência que já existe).
  - **Não bloqueia** (melhoria, risco futuro, cenário novo, ideia) → registre na seção "Observações para o usuário" do `docs/STATUS.md` e apresente no resumo final da fase. Não implemente sem combinar: melhoria não combinada é scope creep, por melhor que pareça.
- Achado silencioso é achado perdido: o usuário só fica sabendo do que você contar explicitamente.

## Comentários no código

Código autoexplicativo com bons nomes, quase sem comentários. Comentário só quando responde um "por quê" que o código não consegue dizer: decisão de design, workaround com contexto, referência a uma seção do plano (ex.: `// plan §6: substituida mata o runner em voo`).

Nunca: comentário narrando o que a linha obviamente faz; docblock decorativo em todo método; cabeçalhos/separadores ASCII; TODO solto sem registro correspondente no STATUS.md. Na dúvida, não comente.

## Definição de pronto

Antes de declarar a fase concluída:

1. Todos os critérios de aceite da fase **executados de verdade** — rode os comandos, provoque os cenários, não suponha. Guarde a evidência (saída de comando, resultado de teste) para o resumo final.
2. `pnpm lint` e `pnpm test` verdes.
3. Nenhum código comentado, arquivo morto ou TODO sem registro deixado para trás.

## Encerramento da fase (obrigatório, nesta ordem)

1. Marque no `docs/project-plan.md`, direto no título da fase:

   Antes: `### F1 — Banco e domínio (1–2d)`
   Depois: `### F1 — Banco e domínio (1–2d) ✅ implementada em 2026-08-07`

   Se a sessão terminar com a fase incompleta, marque `⏳ em andamento (iniciada 2026-08-07)` e detalhe o ponto exato no STATUS.md. É essa marcação que faz qualquer nova instância do Claude Code, lendo o plano, saber onde o projeto está.

2. Atualize `docs/STATUS.md`: feito, em andamento, próximo passo, decisões tomadas na fase — e a seção "Observações para o usuário" com o que você identificou que o plano não previu.
3. Resumo final para o usuário: o que foi entregue, evidência de cada aceite, o que ficou de fora e por quê — e as observações e pontos de melhoria identificados durante a fase. Não os deixe apenas no arquivo: apresente-os na conversa.
