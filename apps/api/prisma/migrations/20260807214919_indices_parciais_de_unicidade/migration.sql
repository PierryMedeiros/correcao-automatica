-- Índices únicos parciais escritos à mão: o Prisma não expressa `WHERE` em `@@unique`, então esta
-- migration nasceu vazia com `--create-only` e recebeu o SQL abaixo antes de ser aplicada.
--
-- ATENÇÃO ao regerar migrations: como o schema.prisma não descreve estes índices, um
-- `prisma migrate dev` futuro pode propor DROP neles. Quem avisa é `submissao-ativa.test.ts`, que
-- falha inteiro se qualquer um dos dois sumir — a matriz dos 12 estados é o guard, não a memória.

-- Uma submissão ativa por aluno e desafio (plan §5, §10.5).
--
-- O predicado é escrito por COMPLEMENTO — os três terminais de fato do §6 — e nunca como lista de
-- estados ativos (Apêndice B v1.3 item 1). Assim estado novo entra como ativo automaticamente e as
-- duas listas não têm como divergir. A mesma regra em TypeScript é `STATUS_TERMINAIS` + `estaAtiva`,
-- em packages/shared/src/dominio/estados.ts, que é o módulo titular dela.
--
-- Consequência assumida, e é ela que o §10.5 quer: `link_invalido`, `sem_skill` e `erro` são
-- ATIVOS. O aluno que reenvia com o link corrigido **substitui** a submissão travada — a anterior
-- vai para `substituida` — em vez de abrir uma segunda linha viva para o mesmo desafio.
--
-- `lower(aluno_email)` porque o e-mail vem colado do admin (§9.1): sem isso, `Aluno@x.com` abriria
-- uma segunda submissão ativa ao lado de `aluno@x.com` e furaria o §10.5 em silêncio (D10 da F1).
-- `(projeto, fase)` entra na chave, então o mesmo aluno em dois desafios ao mesmo tempo passa (§10.20).
CREATE UNIQUE INDEX "submissoes_ativa_por_aluno_e_desafio"
    ON "submissoes" (lower("aluno_email"), "projeto", "fase")
    WHERE "status" NOT IN ('enviada', 'cancelada', 'substituida');

-- No máximo um run `ativo` por vez (§10.21, D8 da F1). Constraint em vez de regra de aplicação:
-- §2.4 — a colisão vira impossível, não proibida, ao custo de uma linha de SQL. A saída de `ativo`
-- existe e é o §6.1 (`finalizado` automático, `pausado`/`cancelado` humanos); sem ela o sistema
-- aceitaria exatamente um run na vida.
--
-- Indexar a própria coluna basta: com o filtro, toda linha indexada tem o valor 'ativo', então a
-- segunda colide.
CREATE UNIQUE INDEX "runs_no_maximo_um_ativo"
    ON "runs" ("status")
    WHERE "status" = 'ativo';
