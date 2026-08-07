#!/usr/bin/env bash
# Hook PreToolUse (Bash) — regra dura 1 do CLAUDE.md.
# Prune global apaga recursos de jobs em voo e de outros projetos da mesma máquina.
# Neste repositório não existe prune legítimo: limpeza é sempre escopada por label/prefixo.
set -uo pipefail

comando=$(jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$comando" ] && exit 0

# Trechos entre aspas saem antes do match: mencionar o comando (git commit -m, echo, grep)
# não é executá-lo, e bloquear a menção geraria falso positivo na própria documentação do repo.
sem_strings=$(printf '%s' "$comando" | sed "s/'[^']*'//g; s/\"[^\"]*\"//g")

if printf '%s' "$sem_strings" |
  grep -qE 'docker[[:space:]]+(system|volume|image|container|network|builder|buildx)[[:space:]]+prune'; then
  cat >&2 <<'MSG'
BLOQUEADO — regra dura 1 do CLAUDE.md: prune global de Docker não existe neste projeto.

Ele apagaria recursos de correções em voo (containers fc-job-*, networks fc-job-*_net)
e de outros projetos da máquina. Limpeza aqui é sempre escopada ao job:

  docker ps -aq --filter label=fc.job=<id> | xargs -r docker rm -f
  docker network ls -q --filter label=fc.job=<id> | xargs -r docker network rm
  docker compose -p fc-job-<id> down -v --remove-orphans

Limpeza periódica por idade/label é responsabilidade do janitor (plan §8), não de comando manual.
MSG
  exit 2
fi

exit 0
