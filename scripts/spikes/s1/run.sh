#!/usr/bin/env bash
# Spike S1 (F0.4) — Claude Code headless dentro de container. É o risco nº 1 do projeto (plan §15):
# se travar, F2 e F3 não começam.
#
# Prova, sem nenhuma interação humana, que `claude -p`:
#   - autentica só com CLAUDE_CODE_OAUTH_TOKEN (sem montar ~/.claude do host)
#   - lê uma skill montada :ro e segue a instrução literalmente (plan §8)
#   - escreve um JSON válido no job dir
#   - produz transcript stream-json parseável, com session_id e bloco de uso
#   - aceita `--resume` por `docker exec` no container ainda vivo — o retry corretivo do §7
#
# Uso: scripts/spikes/s1/run.sh [allowedTools|skip]
#   allowedTools (default) — menor superfície; é o que a F0 D1 manda tentar primeiro
#   skip                   — --dangerously-skip-permissions; o container é a fronteira (§8)
# Variável: MODELO (default claude-opus-5) — §14: troca de modelo muda a régua, então o id
# exato usado vai para docs/spikes.md.
set -euo pipefail

readonly ID=s1
readonly RUNNER="fc-job-${ID}"
readonly IMAGEM="banca-spike-${ID}:dev"
readonly TIMEOUT_S=600

modo="${1:-allowedTools}"
modelo="${MODELO:-claude-opus-5}"

raiz=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
aqui="${raiz}/scripts/spikes/${ID}"

falhou() {
  echo "FALHOU: $*" >&2
  exit 1
}

case "$modo" in
  allowedTools) flags='--allowedTools Read,Write,Bash' ;;
  skip) flags='--dangerously-skip-permissions' ;;
  *) falhou "modo inválido '${modo}' — use allowedTools ou skip" ;;
esac

echo "== S1.0 — pré-condições (o token nunca é impresso, só verificado)"
[ -f "${raiz}/.env" ] || falhou ".env não existe — copie de .env.example"
grep -q '^CLAUDE_CODE_OAUTH_TOKEN=.\+' "${raiz}/.env" ||
  falhou "CLAUDE_CODE_OAUTH_TOKEN vazio no .env — rode 'claude setup-token' no host (plan §17.3)"
echo "  token presente no .env"

jobs_dir=$(grep -E '^JOBS_DIR=' "${raiz}/.env" | cut -d= -f2-)
[ -n "$jobs_dir" ] || falhou "JOBS_DIR vazio no .env"
job_dir="${jobs_dir}/${ID}"
echo "  job dir: ${job_dir}"
echo "  modo de permissão: ${modo} (${flags})"
echo "  modelo: ${modelo}"

docker image inspect "$IMAGEM" >/dev/null 2>&1 ||
  falhou "${IMAGEM} não existe — rode: docker build -t ${IMAGEM} ${aqui}"

teardown() {
  docker ps -aq --filter "label=fc.job=${ID}" | xargs -r docker rm -f >/dev/null 2>&1 || true
}
trap teardown EXIT
teardown

echo
echo "== S1.1 — job dir com um repo de conteúdo conhecido"
rm -rf "$job_dir"
mkdir -p "${job_dir}/repo"
cat >"${job_dir}/repo/ALVO.txt" <<'ALVO'
primeira linha do alvo
segunda linha do alvo
terceira linha do alvo
quarta linha do alvo
quinta linha do alvo
sexta linha do alvo
sétima linha do alvo
ALVO
cp "${aqui}/prompt.txt" "${job_dir}/prompt.txt"
linhas_esperadas=$(wc -l <"${job_dir}/repo/ALVO.txt")
marcador_esperado=$(grep -m1 '^MARCADOR_LITERAL=' "${aqui}/skill/SKILL.md" | cut -d= -f2-)
echo "  ALVO.txt com ${linhas_esperadas} linhas"
echo "  marcador esperado: ${marcador_esperado}"

echo
echo "== S1.2 — runner de pé, com processo de longa duração como PID 1"
# O entrypoint NÃO pode sair quando o `claude -p` retorna: sem container vivo não há onde o
# `docker exec` do --resume acontecer (plan §8, §9.2 passo 4). Aqui isso vira `sleep infinity`;
# no runner de verdade é o entrypoint que escreve resultado.json e espera o sinal.
# shellcheck disable=SC2016  # o valor de CLAUDE_CODE_OAUTH_TOKEN vem do --env-file, não daqui
docker run -d \
  --name "$RUNNER" \
  --label "fc.job=${ID}" \
  --user corrector \
  -v "${job_dir}:/workspace" \
  -v "${aqui}/skill:/workspace/skill:ro" \
  --env-file <(grep '^CLAUDE_CODE_OAUTH_TOKEN=' "${raiz}/.env") \
  -e "FC_JOB_ID=${ID}" \
  "$IMAGEM" \
  sleep infinity >/dev/null
echo "  ${RUNNER} de pé"

docker exec "$RUNNER" sh -c 'test -n "$CLAUDE_CODE_OAUTH_TOKEN"' ||
  falhou "a variável CLAUDE_CODE_OAUTH_TOKEN não chegou dentro do container"
echo "  a variável chegou no container (valor nunca impresso)"
docker exec "$RUNNER" sh -c 'id && claude --version'

echo
echo "== S1.3 — invocação headless, sem nenhuma interação"
set +e
timeout "$TIMEOUT_S" docker exec \
  -e "MODELO=${modelo}" \
  -e "FLAGS=${flags}" \
  "$RUNNER" \
  sh -c 'cd /workspace && claude -p "$(cat /workspace/prompt.txt)" --model "$MODELO" $FLAGS --output-format stream-json --verbose > /workspace/transcript.jsonl 2>/workspace/erro.txt'
codigo=$?
set -e
echo "  exit code do claude -p: ${codigo}"
if [ "$codigo" -ne 0 ]; then
  echo "--- stderr (recortado) ---"
  head -40 "${job_dir}/erro.txt" 2>/dev/null || true
  echo "--- últimas linhas do transcript ---"
  tail -5 "${job_dir}/transcript.jsonl" 2>/dev/null || true
  falhou "claude -p saiu ${codigo} no modo '${modo}' (600s de timeout). Escada de diagnóstico na F0.4."
fi

echo
echo "== S1.4 — o JSON de saída existe, é válido e bate LITERALMENTE com a skill montada"
[ -f "${job_dir}/out.json" ] || falhou "out.json não foi escrito"
jq -e . "${job_dir}/out.json" >/dev/null || falhou "out.json não é JSON válido"
cat "${job_dir}/out.json"

marcador_obtido=$(jq -r '.marcador_literal // empty' "${job_dir}/out.json")
linhas_obtidas=$(jq -r '.linhas_alvo // empty' "${job_dir}/out.json")
[ "$marcador_obtido" = "$marcador_esperado" ] ||
  falhou "marcador não bate.\n  esperado: ${marcador_esperado}\n  obtido:   ${marcador_obtido}"
[ "$linhas_obtidas" = "$linhas_esperadas" ] ||
  falhou "contagem de linhas errada: esperado ${linhas_esperadas}, obtido ${linhas_obtidas}"
echo "  marcador literal confere · contagem de linhas confere"

echo
echo "== S1.5 — transcript stream-json parseável, com session_id e bloco de uso"
[ -s "${job_dir}/transcript.jsonl" ] || falhou "transcript.jsonl vazio"
linhas_transcript=$(wc -l <"${job_dir}/transcript.jsonl")
jq -e . "${job_dir}/transcript.jsonl" >/dev/null || falhou "transcript.jsonl tem linha não-parseável"
echo "  ${linhas_transcript} linhas, todas parseáveis"

session_id=$(jq -r 'select(.session_id) | .session_id' "${job_dir}/transcript.jsonl" | head -1)
[ -n "$session_id" ] || falhou "nenhum session_id no transcript — o --resume do §7 depende dele"
echo "  session_id: ${session_id}"

echo "  linha final (uso/custo — §15 embasa a conversa de API key):"
jq -c 'select(.type == "result")' "${job_dir}/transcript.jsonl" | tail -1 | sed 's/^/    /'

echo
echo "== S1.6 — nenhum vazamento de segredo no transcript (regra dura 5)"
vazou=$(grep -c 'sk-ant' "${job_dir}/transcript.jsonl" || true)
echo "  grep -c 'sk-ant' transcript.jsonl -> ${vazou}"
[ "$vazou" -eq 0 ] || falhou "o transcript contém 'sk-ant' — segredo vazando"

echo
echo "== S1.7 (D6) — retry corretivo: docker exec + claude --resume no container ainda vivo (§7)"
sha_antes=$(sha256sum "${job_dir}/out.json" | cut -d' ' -f1)
correcao='O validador rejeitou /workspace/out.json: falta o campo booleano "retry_corretivo" com valor true. Reescreva /workspace/out.json com os tres campos originais, valores inalterados, mais esse campo.'
set +e
timeout "$TIMEOUT_S" docker exec \
  -e "SESSION_ID=${session_id}" \
  -e "CORRECAO=${correcao}" \
  -e "FLAGS=${flags}" \
  "$RUNNER" \
  sh -c 'cd /workspace && claude --resume "$SESSION_ID" -p "$CORRECAO" $FLAGS --output-format stream-json --verbose > /workspace/transcript-resume.jsonl 2>/workspace/erro-resume.txt'
codigo_resume=$?
set -e
echo "  exit code do claude --resume: ${codigo_resume}"
if [ "$codigo_resume" -ne 0 ]; then
  head -40 "${job_dir}/erro-resume.txt" 2>/dev/null || true
  falhou "--resume saiu ${codigo_resume} — o retry corretivo do §7 não é viável desta forma"
fi

sha_depois=$(sha256sum "${job_dir}/out.json" | cut -d' ' -f1)
[ "$sha_antes" != "$sha_depois" ] || falhou "out.json não mudou — o --resume não reescreveu a saída"
jq -e . "${job_dir}/out.json" >/dev/null || falhou "out.json ficou inválido depois do --resume"
cat "${job_dir}/out.json"
jq -e '.retry_corretivo == true' "${job_dir}/out.json" >/dev/null ||
  falhou "o campo retry_corretivo não foi acrescentado"
jq -e --arg m "$marcador_esperado" '.marcador_literal == $m' "${job_dir}/out.json" >/dev/null ||
  falhou "o --resume corrompeu o marcador literal"
echo "  out.json reescrito na MESMA sessão, com o campo novo e os valores originais preservados"

echo
echo "== S1.8 — teardown por label"
teardown
sobrou=$(docker ps -aq --filter "label=fc.job=${ID}")
echo "  docker ps -aq --filter label=fc.job=${ID} -> '${sobrou}'"
[ -z "$sobrou" ] || falhou "sobrou container após teardown"

echo
echo "S1 VERDE — headless autenticado por token, skill lida :ro, dossiê escrito, --resume viável."
echo "  modo de permissão adotado: ${modo} (${flags})"
echo "  modelo: ${modelo}"
