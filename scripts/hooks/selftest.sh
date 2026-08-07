#!/usr/bin/env bash
# Selftest dos guards de scripts/hooks/.
# Existe porque o modo de falha de um hook é fail-open: script quebrado, sem bit de execução
# ou com dependência faltando não trava nada — só desprotege, em silêncio. Este script é o
# barulho que o fail-open não faz. Roda no aceite da F0 e sempre que um guard for mexido.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1
raiz=$(pwd)

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

# O guard de segredo varre o que está staged, não o comando. Monta um repo descartável,
# staga as linhas passadas como argumentos e compara o exit code com o esperado.
verifica_staged() {
  local esperado="$1" rotulo="$2"
  shift 2
  local tmp obtido
  tmp=$(mktemp -d)
  git init -q "$tmp"
  git -C "$tmp" config user.email selftest@local
  git -C "$tmp" config user.name selftest
  printf '%s\n' "$@" >"$tmp/alvo.txt"
  git -C "$tmp" add alvo.txt
  (cd "$tmp" && CLAUDE_PROJECT_DIR="$tmp" \
    bash "$raiz/scripts/hooks/bloqueia-segredo-no-commit.sh" \
    <<<"$(printf 'git commit -m "x"' | jq -R '{tool_input:{command:.}}')" >/dev/null 2>&1)
  obtido=$?
  rm -rf "$tmp"
  total=$((total + 1))
  if [ "$obtido" -eq "$esperado" ]; then
    printf '  ok      [%s esperado] %s\n' "$esperado" "$rotulo"
  else
    printf '  FALHOU  [esperado %s, obtido %s] %s\n' "$esperado" "$obtido" "$rotulo"
    falhas=$((falhas + 1))
  fi
}

# Variante do anterior para conteúdo que não é linha de texto: os bytes vêm do stdin e o nome do
# arquivo importa (o guard decide por caminho, contra a lista de binários permitidos).
verifica_staged_bruto() {
  local esperado="$1" rotulo="$2" nome="$3"
  local tmp obtido
  tmp=$(mktemp -d)
  cat >"$tmp/$nome"
  git init -q "$tmp"
  git -C "$tmp" config user.email selftest@local
  git -C "$tmp" config user.name selftest
  git -C "$tmp" add "$nome"
  (cd "$tmp" && CLAUDE_PROJECT_DIR="$tmp" \
    bash "$raiz/scripts/hooks/bloqueia-segredo-no-commit.sh" \
    <<<"$(printf 'git commit -m "x"' | jq -R '{tool_input:{command:.}}')" >/dev/null 2>&1)
  obtido=$?
  rm -rf "$tmp"
  total=$((total + 1))
  if [ "$obtido" -eq "$esperado" ]; then
    printf '  ok      [%s esperado] %s\n' "$esperado" "$rotulo"
  else
    printf '  FALHOU  [esperado %s, obtido %s] %s\n' "$esperado" "$obtido" "$rotulo"
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
# Cada fixture mora na própria linha porque o escape `guard:fixture` é por linha e não cabe em
# continuação com `\`. O prefixo da chave é montado em duas partes: escrito inteiro, o scanner
# acusaria este arquivo.
# As chaves falsas têm comprimento realista de propósito: o guard exige 32+ caracteres depois do
# prefixo para separar credencial de documentação, então fixture curta não exercitaria a regra.
chave_falsa="ANTHROPIC_API_KEY=$(printf '%s%s' 'sk-' 'ant-api03-FALSAfalsa0123456789abcdefGHIJKLMNopqrstuv')"  # guard:fixture
token_falso="CLAUDE_CODE_OAUTH_TOKEN=oat01AbCdEf9876"  # guard:fixture
verifica_staged 2 "chave e token reais staged" "$chave_falsa" "$token_falso"

echo "6. placeholders e senha pública de dev — deve PASSAR"
verifica_staged 0 "vazios, mascarados, \$VAR e senha pública de dev" \
  "CLAUDE_CODE_OAUTH_TOKEN=" \
  "DATABASE_URL=" \
  "RUNNER_TOKEN=***" \
  "      - POSTGRES_PASSWORD=banca" \
  "API_KEY=\${MINHA_VAR}"  # guard:fixture

echo "7. padrão de busca documentado — deve PASSAR"
# Documentar como se confere uma variável não é vazar o valor dela: o que a extração do guard
# devolve nestes casos é pedaço de regex (`.\`, `[^`, `\S`), não credencial. Foi o falso
# positivo que bloqueou o commit do plano de fases em 07/08/2026.
verifica_staged 0 "grep ancorado com quantificador" \
  "- \`grep -q '^CLAUDE_CODE_OAUTH_TOKEN=.\+' .env\` sai 0"  # guard:fixture
verifica_staged 0 "classe de caracteres em awk" \
  "- \`awk -F= '/^ANTHROPIC_API_KEY=[^ ]/ {print}' .env\`"  # guard:fixture
verifica_staged 0 "atalho de classe escapado" \
  "- \`rg '^RUNNER_TOKEN=\S+' .env\`"  # guard:fixture

echo "8. segredo escondido atrás de metacaractere — deve BLOQUEAR"
# A regra do item 7 só dispensa a heurística de variável. A varredura por prefixo de chave roda
# sobre a linha inteira e é independente dela — é isto que impede que o item 7 vire porta.
verifica_staged 2 "chave real precedida de ponto" \
  "ANTHROPIC_API_KEY=.$(printf '%s%s' 'sk-' 'ant-oat01-ESCONDIDAescondida0123456789abcdefGHIJ')"  # guard:fixture
verifica_staged 2 "token real na mesma linha de um grep" \
  "rode \`grep TOKEN .env\` e compare com CLAUDE_CODE_OAUTH_TOKEN=oat01ZzYyXx4321"  # guard:fixture

echo "8b. formato da chave citado em documentação — deve PASSAR"
# Documentar que o token começa com um prefixo não é vazar o token: são 6 caracteres depois do
# prefixo, contra ~100 de uma credencial. Bloquear isso empurra para apagar a documentação de como
# conferir o valor — que é justamente o que evita repetir o diagnóstico do `401 Invalid bearer
# token`. O item 8 acima é o outro lado: chave de comprimento real continua bloqueada.
verifica_staged 0 "prefixo do token citado em prosa" \
  "o valor que vale é o $(printf '%s%s' 'sk-' 'ant-oat01-')… que o CLI imprime no fim"  # guard:fixture
verifica_staged 0 "prefixo em frase de conferência" \
  "**Verificar o formato**: o token começa com \`$(printf '%s%s' 'sk-' 'ant-oat01-')\`"  # guard:fixture
# O prefixo solto em prosa passa; atribuído a uma variável de chave, não — aí quem bloqueia é a
# heurística de variável, que é independente e continua sendo a defesa principal. `.env.example`
# usa chave vazia, então não há caso legítimo de escrever valor mascarado nessa forma.
verifica_staged 2 "prefixo mascarado atribuído a uma chave" \
  "ANTHROPIC_API_KEY=$(printf '%s%s' 'sk-' 'ant-api03-')xxxxxxxxxxxx"  # guard:fixture

echo "9. arquivo binário em conteúdo staged — deve BLOQUEAR"
# Diff de binário não tem linha `+`: sem esta checagem por arquivo, tudo abaixo dela passa em
# branco. Foi como um `.ts` com byte NUL escapou do scanner.
# A entrada vem por substituição de processo, não por pipe: pipe roda a função em subshell e os
# contadores de falha se perderiam — o selftest reportaria OK com verificação vermelha dentro.
verifica_staged_bruto 2 "imagem com bytes nulos" captura.png \
  < <(printf 'PNG'; head -c 8 /dev/zero)
verifica_staged_bruto 2 "byte NUL dentro de .md — extensão não salva" notas.md \
  < <(printf 'notas'; head -c 4 /dev/zero; printf 'fim\n')

echo "10. texto UTF-8 do repo — deve PASSAR"
# Acento, seção, emoji de status e caixa aparecem em todo arquivo de fase: se qualquer um deles
# fosse tratado como binário, o guard bloquearia o repositório inteiro.
verifica_staged_bruto 0 "markdown com acento, §, emoji e caixa" plano.md \
  < <(printf '# Plano — §8, §12\n| A1 | correção · devolutiva |\n✅ ⏳ ⬜ ├─ └─\n')

echo
if [ "$falhas" -eq 0 ]; then
  echo "SELFTEST OK — $total verificações, 0 falhas."
  exit 0
fi
echo "SELFTEST FALHOU — $falhas de $total verificações. Os guards NÃO estão protegendo o repo."
exit 1
