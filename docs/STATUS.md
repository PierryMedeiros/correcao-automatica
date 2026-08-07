# STATUS

Atualizado em: 07/08/2026 (America/Sao_Paulo) — base de documentação fechada, antes do primeiro dia de código

## Feito

- `docs/project-plan.md` **v1.3** — releitura integral com o repo na frente; 10 contradições e decisões pendentes fechadas (Apêndice B)
- Repo criado e publicado em `github.com/PierryMedeiros/correcao-automatica`; histórico sem rastro de atribuição de IA
- Ambiente de dev assistido por IA: `CLAUDE.md`, skills `implementar-fase` e `commit-e-push`, `README.md`
- Guards executáveis das regras duras em `scripts/hooks/` (prune global de Docker, force push na main, segredo em conteúdo staged), registrados como hooks `PreToolUse` no `.claude/settings.json`; `git commit`/`git push` em `permissions.ask`
- `scripts/hooks/selftest.sh` — 20 verificações, verde; entra no aceite da F0
- `docs/INTEGRATION.md` — premissas e perguntas abertas para a equipe da plataforma FC (entrega da F0)
- `docs/skills-map.csv` — 49 linhas com `skill_slug` preenchido e `modo_avaliacao` sugerido em 14
- `docs/legado/` — `corretor-desafios.md` e o README das skills, insumos do Apêndice A/F3, agora versionados
- `.env.example` com `CLAUDE_CODE_OAUTH_TOKEN`, `DATABASE_URL`, `SKILLS_DIR`, `JOBS_DIR`, `RUNNER_IMAGE`

## Em andamento

- **F0 — metade "fundação" pronta em 07/08/2026.** Monorepo pnpm, TypeScript strict, vitest, eslint+prettier e `compose.yaml` com Postgres 16 de pé e validado. Falta a outra metade: os spikes S1 → S2 → S3 e o `docs/spikes.md`. A fase só fecha (✅) com os três verdes.

## Próximo passo

- **Reiniciar o Claude Code neste repo** para os hooks entrarem em vigor; conferir com `/hooks` e rodar `pnpm guards`
- Fechar a F0: rodar os spikes na ordem S1 → S2 → S3 documentando em `docs/spikes.md`. S1 depende do `claude setup-token` (§17.3) e é o risco nº 1 do projeto
- Depois: F1 (plan §5) — schema Prisma, `pg_trgm` por migration, seed do `docs/skills-map.csv`
- Pendências humanas (plan §17): completar `docs/skills-map.csv` (projeto/fase de todas, revisar os 14 modos, classificar os 35 restantes), golden repos G1–G10, `claude setup-token`, `.wslconfig`

## Decisões recentes

- 2026-08-06: NestJS + Prisma, PrimeVue, pg-boss, pnpm workspaces, nome-código "Banca" (justificativas no plan §4)
- 2026-08-06: auth do runner via `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`), não por montagem de credenciais
- 07/08/2026: regra dura só vale se for executável — as três de maior custo viraram hook que bloqueia, não conselho
- 07/08/2026: hooks em `scripts/hooks/` (versionado, revisável em diff), não em `.claude/hooks/`
- 07/08/2026: plano não arquiva seções ao envelhecer; fase implementada só muda quem é a referência primária dos detalhes
- 07/08/2026: "ativo" definido por complemento dos terminais do §6, para as duas listas não divergirem
- 07/08/2026: skills ficam fora da árvore do repo, via `SKILLS_DIR`, sem cópia/symlink/submódulo
- 07/08/2026: `SKILLS_DIR` = `/home/pierry/fullcycle/.claude/skills` (49 skills), **não** `/home/pierry/projeto-skills` (39, snapshot de abril)
- 07/08/2026: `skills_map` é a fonte da verdade do `modo_avaliacao`; frontmatter das skills não muda
- 07/08/2026: Node fixado em 24 (`.nvmrc`) e pnpm 11.7.0 pinado em `packageManager` — o runner segue com Node 22 (plan §8), que é toolchain de aluno e não tem relação com a do host
- 07/08/2026: `apps/*` e `packages/*` declarados no workspace mas **não criados** — shell de app vazio é código morto, e a regra dura 8 proíbe adiantar fase. Cada pacote nasce na fase que o preenche
- 07/08/2026: prettier não formata markdown (`.prettierignore`) — plano e skills são prosa com quebras e tabelas deliberadas

## Observações para o usuário

- **Hooks só valem a partir da próxima sessão.** Verificado ao vivo: `docker system prune --help` passou sem bloqueio com o `settings.json` já salvo e válido. A lógica está provada pelo selftest; o wiring só depois de reiniciar. Confira com `/hooks`.
- **Fail-open é o modo de falha do hook.** Script sumido, sem bit de execução ou com timeout estourado deixa o comando passar — quebrar o guard não trava o trabalho, silenciosamente desprotege. `selftest.sh` existe para transformar isso em falha barulhenta; rode-o quando mexer em qualquer guard.
- **Guard não substitui a regra escrita.** O hook cobre o caminho `Bash`; escrever segredo em arquivo via Write/Edit passa longe dele. E commit feito por você direto no terminal não passa por nenhum guard — se quiser cobrir esse caminho, o mesmo scanner funciona como `pre-commit` do git.
- **O diretório de skills mora dentro de `.claude/`.** Funciona hoje e o versionamento está resolvido (é repo git próprio), mas é um diretório de configuração de ferramenta virando dependência de runtime do sistema. Registrado como §17 item 7 para resolver antes da F8, quando o caminho vira config de servidor.
- **O snapshot defasado foi renomeado para `/home/pierry/projeto-skills-DEFASADO`** em 07/08/2026 (39 skills, conteúdo de abril). O nome existe para que nenhuma sessão futura o confunda com a fonte da verdade; o conteúdo ficou intacto e ele continua sendo repo git, então nada foi perdido. Se em algum momento você confirmar que não há nada só nele, pode apagar.
- **Buraco no scanner de segredo: arquivo binário passa batido.** Descoberto ao commitar — um byte NUL num `.ts` (erro de escrita, já corrigido) fez o git tratá-lo como binário, e diff binário não tem linhas `+`, que é exatamente o que `bloqueia-segredo-no-commit.sh` varre. Ou seja: segredo dentro de arquivo que o git considere binário não é detectado. O conserto é o hook recusar (ou avisar sobre) arquivo binário novo em conteúdo staged — binário raramente é legítimo neste repo. Não implementado: precisa de combinação, e o caminho de arquivo binário legítimo (imagem em docs, por exemplo) tem que ser decidido junto.
- **Node não está no PATH de shell não-interativo.** Ele existe via nvm (v20.20.2 e v24.11.1), mas `nvm.sh` só carrega em shell interativo — qualquer script, hook ou cron que rode `node`/`pnpm` sem carregar o nvm antes vai falhar com "command not found". Se isso incomodar na F2 (Job Controller chamando processos), o conserto é caminho absoluto ou `corepack` no PATH do serviço.
- **`docker compose up -d` foi executado e o Postgres ficou de pé** (`banca-dev-db-1`, healthy, com `restart: unless-stopped`). Se preferir a máquina limpa: `docker compose down` — o volume `banca-dev_pgdata` sobrevive.
- **A porta 5432 está publicada no host.** É o banco de dev, não uma stack de aluno, então não viola o §8 — mas se você já tiver um Postgres local nessa porta, o `up` falha e o conserto é mudar o lado esquerdo do mapeamento no `compose.yaml`.
- **`pnpm test` hoje cobre um artefato, não código.** O único teste valida a estrutura do `docs/skills-map.csv` (cabeçalho, 6 colunas, slug único e com prefixo, enum de modo, par projeto+fase único). Escolhi isso em vez de um teste-placeholder porque é o arquivo que você vai editar à mão amanhã, com 49 linhas — é onde o erro de digitação realmente acontece. Quando a F1 escrever o seed, esse teste vira o contrato que ele já tem que respeitar.
- **`modo_avaliacao` do CSV é digitado à mão** e o §7 só detecta divergência *depois* que a correção rodou (vira gatilho, força revisão). Ou seja: modo errado no CSV custa uma correção desperdiçada, não uma devolutiva errada enviada. Aceito conscientemente.
