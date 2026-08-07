#!/usr/bin/env bash
# Hook PreToolUse (Bash) — skill commit-e-push, seção "Push".
# Force push na main reescreve histórico já publicado; conserto que exija isso passa pelo usuário antes.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

comando=$(jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$comando" ] && exit 0

sem_strings=$(printf '%s' "$comando" | sed "s/'[^']*'//g; s/\"[^\"]*\"//g")

printf '%s' "$sem_strings" | grep -qE '(^|[;&|]|[[:space:]])git[[:space:]]+push([[:space:]]|$)' || exit 0

# Força pode vir como --force, --force-with-lease, -f (inclusive em cluster de flags curtas)
# ou como refspec com + na frente (git push origin +main).
printf '%s' "$sem_strings" |
  grep -qE '(--force(-with-lease)?([=[:space:]]|$)|[[:space:]]-[a-zA-Z]*f([[:space:]]|$)|[[:space:]]\+(refs/heads/)?[A-Za-z0-9._/-]+)' || exit 0

# Alvo é a main se ela aparece no comando ou se é a branch atual — sem refspec, o push
# atinge a branch em que estamos. Estar na main e forçar outra branch também é bloqueado:
# em push forçado, errar para o lado seguro custa uma pergunta, errar para o outro custa histórico.
alvo_main=0
printf '%s' "$sem_strings" | grep -qE '(^|[[:space:]+/])main([[:space:]]|$)' && alvo_main=1
[ "$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" = "main" ] && alvo_main=1
[ "$alvo_main" -eq 1 ] || exit 0

cat >&2 <<'MSG'
BLOQUEADO — skill commit-e-push: force push na main, nunca.

A main deste repo já está publicada; reescrever o histórico dela quebra qualquer clone existente
e apaga a trilha de auditoria que o projeto depende (plan §12).

Se o histórico realmente precisa de conserto, pare e traga ao usuário antes — a decisão é dele.
Divergência com o remoto se resolve com: git pull --rebase, resolver, rodar os testes, push normal.
MSG
exit 2
