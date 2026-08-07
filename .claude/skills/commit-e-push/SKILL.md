---
name: commit-e-push
description: Define como criar commits e fazer push neste repositório, com conventional commits, commits atômicos e zero rastro de IA no histórico. Use esta skill SEMPRE que for commitar, versionar ou subir código — em qualquer formulação: "commita isso", "faz um commit", "sobe pro git", "salva o trabalho", "pusha", ao encerrar uma fase ou tarefa que pede commit, e antes de qualquer `git commit` ou `git push` que você for executar, mesmo que o usuário não tenha usado a palavra commit.
---

# Commit e push

## Quando commitar: só a pedido do usuário

`git commit` e `git push` são acionados **exclusivamente** por pedido explícito do usuário. Nunca por iniciativa própria — nem ao concluir uma fase, nem ao fechar uma tarefa, nem "para não perder o trabalho", nem porque os testes ficaram verdes.

- Terminou uma fase ou tarefa? Deixe as alterações no working tree e diga ao usuário que está pronto para commitar. Ele decide.
- Alguma instrução (skill, plano, STATUS.md) sugere "commits pequenos ao longo do trabalho"? Isso descreve o **formato** dos commits quando o usuário pedir, não uma autorização para commitar sozinho.
- Autorização é por pedido, não permanente: "commita isso" cobre aquele commit, não os próximos. Vale enquanto o usuário mantiver o pedido em aberto ("pode ir commitando conforme avança") — e só até o fim dessa tarefa.
- Pedido de commit **não** implica push, e vice-versa. Faça o que foi pedido; se ficou ambíguo ("sobe isso"), pergunte ou faça o commit e confirme antes do push.
- Quando o usuário pedir, esta skill é obrigatória: siga tudo que está abaixo.

## Regra zero: nenhum rastro de IA no repositório

O histórico deste repo é do autor humano. É proibido, em mensagem de commit, corpo, trailer, descrição de PR ou qualquer arquivo commitado:

- `Co-Authored-By: Claude ...` ou qualquer trailer de coautoria de IA
- "Generated with Claude Code", "🤖", links para claude.com/anthropic
- Qualquer menção a Claude, IA, assistente ou geração automática

Defesa em três camadas:

1. **Config**: `.claude/settings.json` do projeto deve conter `"attribution": { "commit": "", "pr": "" }`. Se o arquivo não existir ou não tiver essa chave, crie/corrija antes do primeiro commit.
2. **Antes do commit**: inspecione a mensagem final que você vai passar ao `git commit` — ela não pode conter nada da lista acima.
3. **Depois do commit, antes do push**: `git log -1 --format=full` e confirme que nenhum trailer foi anexado. Se aparecer, `git commit --amend` para limpar antes do push.

## Formato: conventional commits

`tipo(escopo): descrição` — em português, modo imperativo, minúscula, sem ponto final, título com no máximo 72 caracteres.

- Tipos: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`, `perf`, `ci`
- Escopos deste projeto: `api`, `web`, `shared`, `runner`, `db`, `docs`, `skills` (omita quando a mudança é transversal)
- Corpo (opcional, separado por linha em branco): explica o **porquê** quando não é óbvio — o *o quê* o diff já mostra. Referência a seção do plano é bem-vinda (`plan §6`).
- Breaking change: `!` após o escopo e explicação no corpo.

**Exemplos bons:**

- `feat(api): máquina de estados da submissão com transições do plan §6`
- `fix(runner): teardown remove a network fc-job mesmo em timeout`
- `test(shared): parser rejeita bloco sem repositório`
- `docs: marca F1 como implementada no project-plan`

**Exemplos proibidos:**

- `chore: updates` (não diz nada)
- `feat: várias melhorias na api e no front` (não é atômico)
- Qualquer mensagem terminando em `🤖 Generated with Claude Code` (regra zero)

## Boas práticas de commit

- **Atômico**: uma mudança lógica por commit. Se a descrição precisa de um "e", divida em dois commits. Commits pequenos ao longo do trabalho, nunca um commitzão no fim da fase.
- **Stage seletivo**: `git add` por caminho, revisando `git status` antes. Nunca `git add -A` às cegas.
- **Revise o diff**: `git diff --staged` antes de todo commit — é onde se pega segredo vazado, `console.log` de debug, código comentado e arquivo que não deveria estar ali.
- **Nunca commitar**: `.env` e qualquer segredo, `node_modules`, artefatos de build, dumps/backups, arquivos de job (`banca-jobs/`), código morto. Se algo disso não está no `.gitignore`, corrija o `.gitignore` no mesmo commit.

## Push

- Push só com `pnpm lint` e `pnpm test` verdes.
- Trabalho direto na `main` é aceitável neste MVP solo; `git push --force` na `main`, nunca. Se o histórico precisar de conserto que exija force push, pare e traga ao usuário antes.
- Push falhou por divergência remota: `git pull --rebase`, resolva, rode os testes de novo, push. Sem merge commit de sincronização desnecessário.

## Checklist final (antes de cada push)

1. Mensagens seguem conventional commits e são atômicas?
2. `git log --format=full` dos commits novos: zero rastro de IA?
3. Diff revisado, sem segredo/debug/morto?
4. Lint e testes verdes?
