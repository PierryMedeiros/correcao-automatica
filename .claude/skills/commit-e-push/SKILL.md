---
name: commit-e-push
description: Define como criar commits e fazer push neste repositório, com conventional commits, recorte combinado com o usuário (atômico por default) e zero rastro de IA no histórico. Use esta skill SEMPRE que for commitar, versionar ou subir código — em qualquer formulação: "commita isso", "faz um commit", "sobe pro git", "salva o trabalho", "pusha", ao encerrar uma fase ou tarefa que pede commit, e antes de qualquer `git commit` ou `git push` que você for executar, mesmo que o usuário não tenha usado a palavra commit.
---

# Commit e push

## Quando commitar: só a pedido do usuário

`git commit` e `git push` são acionados **exclusivamente** por pedido explícito do usuário. Nunca por iniciativa própria — nem ao concluir uma fase, nem ao fechar uma tarefa, nem "para não perder o trabalho", nem porque os testes ficaram verdes.

- Terminou uma fase ou tarefa? Deixe as alterações no working tree e diga ao usuário que está pronto para commitar. Ele decide.
- Alguma instrução (skill, plano, STATUS.md) sugere "commits pequenos ao longo do trabalho"? Isso descreve o **formato** dos commits quando o usuário pedir, não uma autorização para commitar sozinho.
- Autorização é por pedido, não permanente: "commita isso" cobre aquele commit, não os próximos. Vale enquanto o usuário mantiver o pedido em aberto ("pode ir commitando conforme avança") — e só até o fim dessa tarefa.
- Pedido de commit **não** implica push, e vice-versa. Faça o que foi pedido; se ficou ambíguo ("sobe isso"), pergunte ou faça o commit e confirme antes do push.
- Quando o usuário pedir, esta skill é obrigatória: siga tudo que está abaixo.

## Primeiro passo: perguntar o recorte

Antes de qualquer `git add`, olhe o que há para commitar e conte quantas **mudanças lógicas
distintas** existem. Se for mais de uma, **pergunte ao usuário** como ele quer o recorte, apresentando
a divisão que você faria:

> Tem 3 mudanças distintas aqui:
> 1. `feat: conclui a F0 com os três spikes verdes` — `scripts/spikes/`, `docs/spikes.md`, arquivo da F0
> 2. `docs: fecha o skills-map com os pares reais da plataforma` — o CSV e o doc de revisão
> 3. `docs: sobe ao plano a normalização da URL do repositório` — plano e F5
>
> Faço três commits ou você prefere tudo em um?

Regras deste passo:

- **Não pergunte quando o usuário já disse.** "commita tudo junto", "um commit só", "commits
  separados" no próprio pedido já é a resposta — perguntar de novo é ruído.
- **Não pergunte quando só há uma mudança lógica.** Commitar direto é o certo.
- **Apresente a divisão concreta**, com título e arquivos de cada commit. "Quer atômico ou junto?" sem
  mostrar o recorte obriga o usuário a adivinhar o que você tem em mente.
- **A resposta vale para esse pedido**, não para os próximos.
- Se o usuário escolher um commit só, o resto desta skill continua valendo integralmente — inclusive
  revisar o `git diff --staged` antes de commitar. Commit único não é commit sem revisão.

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
- `feat: várias melhorias na api e no front` (não diz o que mudou nem por quê — commit único a pedido do usuário é legítimo, mensagem vaga não)
- Qualquer mensagem terminando em `🤖 Generated with Claude Code` (regra zero)

## Boas práticas de commit

- **Atômico é o default, não a imposição**: uma mudança lógica por commit; se a descrição precisa de um "e", seriam dois commits. É o que você **propõe** no primeiro passo — mas quem decide o recorte é o usuário, e commit único a pedido dele é resultado legítimo, não desvio.
- **Stage seletivo**: `git add` por caminho, revisando `git status` antes. `git add .` só quando o usuário pediu o commit único — e mesmo aí, revisando o que entrou antes de commitar. O que nunca vale é adicionar sem olhar.
- **Revise o diff**: `git diff --staged` antes de todo commit — é onde se pega segredo vazado, `console.log` de debug, código comentado e arquivo que não deveria estar ali.
- **Nunca commitar**: `.env` e qualquer segredo, `node_modules`, artefatos de build, dumps/backups, arquivos de job (`banca-jobs/`), código morto. Se algo disso não está no `.gitignore`, corrija o `.gitignore` no mesmo commit.

## Push

- Push só com `pnpm lint` e `pnpm test` verdes.
- Trabalho direto na `main` é aceitável neste MVP solo; `git push --force` na `main`, nunca. Se o histórico precisar de conserto que exija force push, pare e traga ao usuário antes.
- Push falhou por divergência remota: `git pull --rebase`, resolva, rode os testes de novo, push. Sem merge commit de sincronização desnecessário.

## Checklist final (antes de cada push)

1. O recorte foi combinado com o usuário (ou era mudança única) e as mensagens seguem conventional commits?
2. `git log --format=full` dos commits novos: zero rastro de IA?
3. Diff revisado, sem segredo/debug/morto?
4. Lint e testes verdes?
