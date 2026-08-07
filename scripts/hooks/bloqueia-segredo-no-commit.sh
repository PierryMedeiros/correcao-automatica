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

# Caminhos em que binário versionado é legítimo, como globs de shell. Hoje vazia de propósito:
# nada neste repo precisa de binário. Liberar um caso é acrescentar o glob aqui, em commit
# próprio — assim a liberação aparece no diff e passa por revisão, em vez de acontecer no
# silêncio de um `--no-verify`.
binarios_permitidos=(
  # 'docs/imagens/*.png'
)

# Arquivo que o git considera binário não tem linha `+` no diff, então toda a varredura abaixo
# passa por cima dele — foi assim que um `.ts` com byte NUL escapou do scanner. Por isso a
# detecção é por arquivo, não por linha, e roda antes do early-exit por diff sem adições.
binarios=""
while IFS= read -r arquivo; do
  [ -z "$arquivo" ] && continue
  permitido=0
  for glob in ${binarios_permitidos+"${binarios_permitidos[@]}"}; do
    # shellcheck disable=SC2254  # o glob é padrão de propósito, não literal
    case "$arquivo" in $glob)
      permitido=1
      break
      ;;
    esac
  done
  [ "$permitido" -eq 1 ] && continue
  binarios="${binarios}  ${arquivo}"$'\n'
done < <(git diff --staged --numstat --diff-filter=AM 2>/dev/null |
  awk -F'\t' '$1 == "-" && $2 == "-" { print $3 }')

# Linha marcada com `guard:fixture` sai da varredura. Existe por um caso real e estreito:
# o selftest deste guard precisa carregar segredos falsos para provar que a detecção funciona.
# É escape explícito e greppável de propósito — `grep -rn guard:fixture` lista todos numa auditoria.
adicionadas=$(printf '%s' "$diff_alvo" | grep -E '^\+' | grep -vE '^\+\+\+' | grep -v 'guard:fixture' || true)
[ -z "$adicionadas" ] && [ -z "$binarios" ] && exit 0

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
  # Valor que começa com metacaractere de regex é padrão de busca sendo documentado, não
  # credencial: `grep -q '^FOO_TOKEN=.\+' .env` faz a extração acima devolver `.\`. Nenhum
  # formato de token, chave ou senha começa com `.`, `^`, `[` ou `\` — e a varredura por
  # prefixo de chave (acima, sobre a linha inteira) não passa por aqui, então esconder um
  # segredo real atrás de um ponto continua bloqueado. O selftest prova as duas coisas.
  case "$valor" in .* | '^'* | '['* | '\'*) continue ;; esac
  printf '%s' "$valor" | grep -qiE "$placeholders" && continue
  variaveis="${variaveis}${linha}"$'\n'
done <<<"$candidatas"

[ -z "$chaves" ] && [ -z "$variaveis" ] && [ -z "$binarios" ] && exit 0

{
  echo "BLOQUEADO — scanner de conteúdo staged (regra dura 5 do CLAUDE.md)."
  if [ -n "$chaves" ] || [ -n "$variaveis" ]; then
    echo
    echo "Linhas suspeitas no que está staged:"
    { [ -n "$chaves" ] && printf '%s\n' "$chaves"
      [ -n "$variaveis" ] && printf '%s' "$variaveis"; } | sort -u
    echo
    echo "Tire o valor do arquivo, ponha em .env (gitignored) e deixe no versionado só a chave"
    echo "vazia em .env.example. Se for falso positivo, avise o usuário — não contorne o hook."
  fi
  if [ -n "$binarios" ]; then
    echo
    echo "Arquivo binário em conteúdo staged:"
    printf '%s' "$binarios"
    echo "Diff de binário não tem linha '+', então a varredura de segredo passa por cima dele:"
    echo "um segredo dentro de um arquivo que o git considere binário não seria detectado."
    echo
    echo "Se for engano — byte NUL escrito por acidente, artefato de build, dump — conserte o"
    echo "arquivo ou tire do stage. Se o binário for mesmo necessário, acrescente o glob do"
    echo "caminho ao array 'binarios_permitidos' em scripts/hooks/bloqueia-segredo-no-commit.sh,"
    echo "em um commit próprio: a liberação precisa aparecer no diff e ser revisada."
  fi
} >&2
exit 2
