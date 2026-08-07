#!/usr/bin/env bash
# Hook PreToolUse (Bash) — regra dura 5 do CLAUDE.md: segredo só no .env, nunca em commit.
# Varre as linhas ADICIONADAS do que está prestes a ser commitado.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

comando=$(jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$comando" ] && exit 0
printf '%s' "$comando" | grep -qE '(^|[;&|]|[[:space:]])git[[:space:]]+commit([[:space:]]|$)' || exit 0

diff_alvo=$(git diff --staged 2>/dev/null)
# git commit -a comita modificação de arquivo rastreado sem passar pelo index — esse diff
# também vai para o commit, então também precisa ser varrido.
if printf '%s' "$comando" | grep -qE '[[:space:]]-[a-zA-Z]*a([[:space:]]|$)|--all([[:space:]]|$)'; then
  diff_alvo="$diff_alvo
$(git diff 2>/dev/null)"
fi

# Linha marcada com `guard:fixture` sai da varredura. Existe por um caso real e estreito:
# o selftest deste guard precisa carregar segredos falsos para provar que a detecção funciona.
# É escape explícito e greppável de propósito — `grep -rn guard:fixture` lista todos numa auditoria.
adicionadas=$(printf '%s' "$diff_alvo" | grep -E '^\+' | grep -vE '^\+\+\+' | grep -v 'guard:fixture' || true)
[ -z "$adicionadas" ] && exit 0

# O literal é montado em duas partes de propósito: escrito inteiro, este script dispararia
# contra si mesmo no primeiro commit que o incluísse.
prefixo_anthropic='sk-''ant-'
chaves=$(printf '%s' "$adicionadas" | grep -E "${prefixo_anthropic}[A-Za-z0-9_-]+" || true)

# Valores que são claramente marcador, não segredo: vazios (o regex abaixo já exige valor
# não-vazio), mascarados, interpolações de shell e a senha pública do Postgres de dev (plan F0).
placeholders='^(banca|postgres|changeme|change-me|troque|todo|placeholder|example|exemplo|null|none|seu[-_]?(token|segredo|valor)|your[-_]?(token|key|password|secret)|x{3,}|\*+|\.\.\.|<[^>]*>|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?)$'

candidatas=$(printf '%s' "$adicionadas" |
  grep -E '[A-Za-z0-9_]*(_TOKEN|_KEY|PASSWORD|_SECRET)[A-Za-z0-9_]*[[:space:]]*=[[:space:]]*[^[:space:]]' || true)

variaveis=""
while IFS= read -r linha; do
  [ -z "$linha" ] && continue
  valor=$(printf '%s' "$linha" |
    sed -E 's/.*(_TOKEN|_KEY|PASSWORD|_SECRET)[A-Za-z0-9_]*[[:space:]]*=[[:space:]]*//' |
    sed -E 's/^["'\''`]+//; s/["'\''`,;].*$//; s/[[:space:]].*$//')
  [ -z "$valor" ] && continue
  printf '%s' "$valor" | grep -qiE "$placeholders" && continue
  variaveis="${variaveis}${linha}"$'\n'
done <<<"$candidatas"

[ -z "$chaves" ] && [ -z "$variaveis" ] && exit 0

{
  echo "BLOQUEADO — regra dura 5 do CLAUDE.md: segredo não entra no repositório."
  echo
  echo "Linhas suspeitas no que está staged:"
  { [ -n "$chaves" ] && printf '%s\n' "$chaves"
    [ -n "$variaveis" ] && printf '%s' "$variaveis"; } | sort -u
  echo
  echo "Tire o valor do arquivo, ponha em .env (gitignored) e deixe no versionado só a chave"
  echo "vazia em .env.example. Se for falso positivo, avise o usuário — não contorne o hook."
} >&2
exit 2
