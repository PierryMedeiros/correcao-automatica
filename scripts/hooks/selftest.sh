#!/usr/bin/env bash
# Selftest dos guards de scripts/hooks/.
# Existe porque o modo de falha de um hook é fail-open: script quebrado, sem bit de execução
# ou com dependência faltando não trava nada — só desprotege, em silêncio. Este script é o
# barulho que o fail-open não faz. Roda no aceite da F0 e sempre que um guard for mexido.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1

falhas=0
total=0

# Injeta o comando no hook pelo mesmo contrato de stdin que o Claude Code usa
# (PreToolUse entrega o JSON do tool_input) e compara o exit code com o esperado.
verifica() {
  local hook="$1" esperado="$2" comando="$3"
  local obtido
  printf '%s' "$comando" | jq -R '{tool_input:{command:.}}' |
    "./scripts/hooks/$hook" >/dev/null 2>&1
  obtido=$?
  total=$((total + 1))
  if [ "$obtido" -eq "$esperado" ]; then
    printf '  ok      [%s esperado] %s\n' "$esperado" "$comando"
  else
    printf '  FALHOU  [esperado %s, obtido %s] %s\n' "$esperado" "$obtido" "$comando"
    falhas=$((falhas + 1))
  fi
}

for h in bloqueia-prune-docker.sh bloqueia-force-push-main.sh bloqueia-segredo-no-commit.sh; do
  if [ ! -x "./scripts/hooks/$h" ]; then
    echo "FALHOU: ./scripts/hooks/$h não existe ou não é executável"
    falhas=$((falhas + 1))
  fi
done
command -v jq >/dev/null || { echo "FALHOU: jq não encontrado — os três hooks dependem dele"; exit 1; }

echo "1. prune global de Docker (regra dura 1) — deve BLOQUEAR"
for c in "docker system prune -f" "docker volume prune" "docker image prune -a" \
  "docker network prune" "docker builder prune -af" "docker container prune"; do
  verifica bloqueia-prune-docker.sh 2 "$c"
done

echo "2. limpeza escopada e menção em texto — deve PASSAR"
for c in "docker compose -p fc-job-12 down -v --remove-orphans" \
  "docker ps -aq --filter label=fc.job=12" \
  "git commit -m \"documenta que prune global é proibido\""; do
  verifica bloqueia-prune-docker.sh 0 "$c"
done

echo "3. force push na main (skill commit-e-push) — deve BLOQUEAR"
for c in "git push --force origin main" "git push -f origin main" \
  "git push --force-with-lease origin main" "git push origin +main" "git push --force"; do
  verifica bloqueia-force-push-main.sh 2 "$c"
done

echo "4. push normal — deve PASSAR"
for c in "git push origin main" "git push -u origin main" "git push" "git status"; do
  verifica bloqueia-force-push-main.sh 0 "$c"
done

echo "5. segredo em conteúdo staged (regra dura 5) — deve BLOQUEAR"
tmp_repo=$(mktemp -d)
git init -q "$tmp_repo"
git -C "$tmp_repo" config user.email selftest@local
git -C "$tmp_repo" config user.name selftest
# O prefixo é montado em duas partes: escrito inteiro, o scanner acusaria este próprio arquivo.
printf 'ANTHROPIC_API_KEY=%s%s\n' 'sk-' 'ant-teste123' >"$tmp_repo/vaza.txt"  # guard:fixture
printf 'CLAUDE_CODE_OAUTH_TOKEN=oat01AbCdEf9876\n' >>"$tmp_repo/vaza.txt"  # guard:fixture
git -C "$tmp_repo" add vaza.txt
(cd "$tmp_repo" && CLAUDE_PROJECT_DIR="$tmp_repo" \
  bash "$OLDPWD/scripts/hooks/bloqueia-segredo-no-commit.sh" \
  <<<"$(printf 'git commit -m "x"' | jq -R '{tool_input:{command:.}}')" >/dev/null 2>&1)
obtido=$?
total=$((total + 1))
if [ "$obtido" -eq 2 ]; then
  echo "  ok      [2 esperado] arquivo com chave e token reais staged"
else
  echo "  FALHOU  [esperado 2, obtido $obtido] arquivo com chave e token reais staged"
  falhas=$((falhas + 1))
fi

echo "6. placeholders e senha pública de dev — deve PASSAR"
git -C "$tmp_repo" rm -q --cached vaza.txt
rm -f "$tmp_repo/vaza.txt"
{
  printf 'CLAUDE_CODE_OAUTH_TOKEN=\n'  # guard:fixture
  printf 'DATABASE_URL=\n'
  printf 'RUNNER_TOKEN=***\n'  # guard:fixture
  printf '      - POSTGRES_PASSWORD=banca\n'  # guard:fixture
  printf 'API_KEY=${MINHA_VAR}\n'  # guard:fixture
} >"$tmp_repo/ok.txt"
git -C "$tmp_repo" add ok.txt
(cd "$tmp_repo" && CLAUDE_PROJECT_DIR="$tmp_repo" \
  bash "$OLDPWD/scripts/hooks/bloqueia-segredo-no-commit.sh" \
  <<<"$(printf 'git commit -m "x"' | jq -R '{tool_input:{command:.}}')" >/dev/null 2>&1)
obtido=$?
total=$((total + 1))
if [ "$obtido" -eq 0 ]; then
  echo "  ok      [0 esperado] vazios, mascarados, \$VAR e senha pública de dev"
else
  echo "  FALHOU  [esperado 0, obtido $obtido] vazios, mascarados, \$VAR e senha pública de dev"
  falhas=$((falhas + 1))
fi
rm -rf "$tmp_repo"

echo
if [ "$falhas" -eq 0 ]; then
  echo "SELFTEST OK — $total verificações, 0 falhas."
  exit 0
fi
echo "SELFTEST FALHOU — $falhas de $total verificações. Os guards NÃO estão protegendo o repo."
exit 1
