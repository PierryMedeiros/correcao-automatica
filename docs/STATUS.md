# STATUS

Atualizado em: 07/08/2026 (America/Sao_Paulo) — plano de fases executável escrito, antes do primeiro dia de código de produção

## Feito

- **`docs/fases/` — o plano de desenvolvimento executável.** Índice + um arquivo por fase (F0–F9): ~2.900 linhas, 78 etapas numeradas e ~555 tarefas com checkbox, além de pré-condições verificáveis, critérios de aceite com comando e evidência esperada, edge cases do §10 atribuídos, escopo negativo com destino, e as seções "Impacto em fases seguintes" e "Registro de execução"
- `docs/project-plan.md` **v1.4** — o §13 virou índice; a propriedade das tarefas e dos critérios de aceite migrou para `docs/fases/`. O plano segue dono da arquitetura e da intenção (Apêndice B v1.4)
- `tests/fases.test.ts` — guard executável de coerência da documentação: toda fase tem arquivo; marcadores de status e dependências batem entre arquivo de fase, índice e §13; grafo `Depende de`/`Destrava` simétrico e sem referência para frente; fase ✅ não deixa tarefa em aberto nem precede as fases de que depende; e o nome do arquivo carrega o sufixo `-concluida` exatamente quando a fase está implementada
- Skill `implementar-fase` reescrita: consome `docs/fases/`, marca progresso durante a fase e encerra com **revisão obrigatória de impacto nas fases seguintes**
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

- **F0 — metade "fundação" pronta em 07/08/2026.** Monorepo pnpm, TypeScript strict, vitest, eslint+prettier e `compose.yaml` com Postgres 16 de pé e validado (etapas F0.1–F0.3, marcadas `[x]` em `docs/fases/F0-fundacao-e-spikes.md`). Falta a outra metade: os spikes S1 → S2 → S3 e o `docs/spikes.md`. A fase só fecha (✅) com os três verdes.

## Próximo passo

- **Reiniciar o Claude Code neste repo** para os hooks entrarem em vigor; conferir com `/hooks` e rodar `pnpm guards`
- **Resolver as decisões em aberto da F0** (D1–D6 no arquivo da fase) — em especial D1, a flag de permissão do CLI, que é o que o §8 delega ao S1
- Fechar a F0: rodar os spikes na ordem S1 → S2 → S3 documentando em `docs/spikes.md`. S1 depende do `claude setup-token` (§17.3) e é o risco nº 1 do projeto
- Depois: F1 — o arquivo da fase tem 10 decisões em aberto que valem 10 minutos de leitura antes de a primeira migration existir
- Pendências humanas (plan §17): completar `docs/skills-map.csv` (projeto/fase de todas, revisar os 14 modos, classificar os 35 restantes), golden repos G1–G10, `claude setup-token`, `.wslconfig`, confirmar as decisões ainda reversíveis (§17.5)

## Decisões recentes

- 07/08/2026: **fases ganharam arquivo próprio** em `docs/fases/`; o §13 do plano virou índice. Motivo: o §13 descrevia a intenção de cada fase, não um plano executável — faltavam tarefas, sequência e o "como provar" de cada aceite
- 07/08/2026: **numeração F0–F9 preservada**, com granularidade fina em etapas internas (F2.1, F2.2…). Renumerar quebraria referências em cinco documentos e no histórico de decisões, em troca de ganho cosmético
- 07/08/2026: **um dono por informação** — plano é dono da arquitetura e da intenção; arquivo de fase é dono das tarefas e dos critérios de aceite. Aceite deixou de existir em dois lugares
- 07/08/2026: **coerência da documentação virou teste** (`tests/fases.test.ts`), na mesma linha dos guards de `scripts/hooks/`: regra que não é executável é conselho
- 07/08/2026: **o scanner de segredo passou a distinguir padrão de busca de valor** — valor extraído que começa com `.`, `^`, `[` ou `\` é fragmento de regex, não credencial. Bloqueava documentar como se confere uma variável (`grep -q '^X_TOKEN=.\+' .env`). A detecção por prefixo de chave é independente e não foi tocada; o selftest prova os dois lados (itens 7 e 8)
- 07/08/2026: **fase implementada é renomeada para `F<n>-<slug>-concluida.md`** — o `ls` de `docs/fases/` passa a ser o painel de progresso. Só o `✅` renomeia (`⬜` e `⏳` mantêm o nome), então cada fase é renomeada uma vez só
- 07/08/2026: **o que o plano não decidiu vira seção "Decisões a tomar nesta fase"**, com opções e recomendação, em vez de ser decidido em silêncio durante a implementação. São ~70 decisões catalogadas nas dez fases
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

Cinco buracos que a quebra em fases expôs — todos existiam no plano e nenhum é erro de escrita. Estão resolvidos nos arquivos de fase; três deles mudam texto do plano quando a fase chegar, e por isso vão para o Apêndice B **antes** da implementação:

- **As skills referenciam um arquivo que não existe dentro do runner.** As 49 skills `corrige-*` apontam para `../_shared/devolutivas-guide.md` (100 arquivos com a referência), mas o §8 monta só `$SKILLS_DIR/<skill_slug>` em `/workspace/skill`. Dentro do container esse caminho não resolve — o agente ficaria sem o guia de devolutivas em toda correção. Registrado como decisão D1 da F3 (montar `$SKILLS_DIR` inteiro `:ro` vs. montar `_shared` num segundo mount). **É mudança do §8.**
- **O runner morre antes do retry corretivo do dossiê.** O §7 exige `docker exec` no runner ainda vivo + `claude --resume`; se o entrypoint encerra quando o `claude -p` retorna, o container já não existe. Resolvido na F2: o entrypoint escreve `resultado.json` e permanece vivo até o Job Controller sinalizar. **É uma linha nova no §8/§9.2.**
- **O `run` nunca sai de `ativo`.** O §5 define `runs.status` com `finalizado`, `pausado` e `cancelado`, o §10.21 bloqueia o segundo run enquanto houver um ativo — e nenhuma fase transicionava um run para fora de `ativo`. Como estava, o sistema aceitaria exatamente um run na vida. Fechado: `finalizado` é automático quando todo o lote chega a estado terminal (F4); `cancelar`, `pausar` e `retomar` são humanos, com rota na F5 e botão na F6. Não há botão "finalizar": encerrar um run com submissão ainda ativa é cancelar, não finalizar por desistência.
- **A validação do repositório não tinha dono.** `git ls-remote`, comparação com `base_repo_url`, pin do `commit_sha` e resolução da skill (§9.2 passo 1) caíam entre a F4 e a F5. Sem isso, submissão criada em `recebida` nunca sairia de lá. Atribuída à F5, com as transições vindo da F4.
- **`LlmExecutor` não nascia em lugar nenhum.** É uma das três fronteiras de inversão que o CLAUDE.md autoriza, é premissa da F8 ("trocar CLI por API key é trocar variável de ambiente") e nenhuma fase a entregava. Passou a ser entrega da F3.

Outros pontos que valem sua atenção:

- **Cada fase carrega uma seção "Decisões a tomar nesta fase"** — 79 perguntas que o plano não respondeu, com opções e recomendação. Vale ler as da fase antes de mandar implementar; são o tipo de coisa que, decidida em silêncio no meio do código, ninguém revisa. As mais consequentes: onde mora o schema Prisma (F1 D1), a flag de permissão do CLI headless (F0 D1), o `<id>` de `fc-job-<id>` (F2 D1), e onde ficam os zips dos golden repos (F7 D1).
- **Dois pontos onde as skills e o plano discordam da régua.** As skills mandam "avaliar o estado atual da branch main", mas o §9.2 faz checkout no SHA pinado (F3 D8). E o Apêndice A tira do prompt a proibição de prune "porque o agente nem tem como" — só que o §8 monta o socket do host no runner, então ele tem (F3 D2).
- **`docker compose` moderno não remove `ports:` com override simples**: merge de lista concatena, então `ports: []` não apaga nada. O caminho é a tag `!reset` (Compose ≥ 2.24). Está no roteiro do spike S3, com plano B.
- **Bind mount relativo no compose do aluno resolve no host, não no runner** — o daemon é o do host via socket montado. O plano não trata disso em lugar nenhum; virou verificação explícita no S3, porque muda o §8 se confirmado.
- **`pnpm test` passa a exigir Postgres de pé a partir da F1.** Consequência natural, mas que hoje não existe: quem clonar o repo e rodar `pnpm test` sem `docker compose up -d` vai ver falha, não skip.
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
