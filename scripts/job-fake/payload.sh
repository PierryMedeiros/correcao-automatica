#!/usr/bin/env bash
# Carga do job fake (F2.0/F2.2): faz o que o agente fará na F3, sem gastar um agente.
#
# Roda DENTRO do runner, invocada pelo entrypoint via `FC_PAYLOAD_CMD` (D4). Exercita exatamente
# os quatro comportamentos que a F2 precisa provar:
#   1. `localhost:8080` dentro do runner é só dele        (§10.13, netns por container)
#   2. a stack do aluno sobe pelo comando canônico e é alcançada por HOSTNAME (§8, §10.14)
#   3. o dossiê é escrito no job dir                       (§7 — aqui estático, a F3 dá o conteúdo)
#   4. camada 1 do teardown: o próprio autor da stack a derruba (§8)
#
# Exit code != 0 aqui vira exit code do job: é assim que o aceite A2 falha alto quando um job
# enxerga o marcador do outro.
set -euo pipefail

readonly JOB_JSON=/workspace/job.json
readonly PORTA_LOCAL=8080

job_id=$(jq -r '.job_id' "$JOB_JSON")
comando=$(jq -r '.compose.comando_canonico // ""' "$JOB_JSON")
export FC_MARCADOR="FAKE-JOB-${job_id}"

echo "payload: job ${job_id}, marcador ${FC_MARCADOR}"

# O aceite A3 (timeout) precisa de um job que demore mais que o limite. Dormir antes de criar
# qualquer coisa é de propósito: o kill do host pega o job no meio e não deixa stack pela metade.
if [ -n "${FC_FAKE_DORMIR_S:-}" ] && [ "${FC_FAKE_DORMIR_S}" -gt 0 ]; then
  echo "payload: dormindo ${FC_FAKE_DORMIR_S}s para provocar o timeout do host"
  sleep "$FC_FAKE_DORMIR_S"
fi

# (1) Processo do próprio runner na 8080 — o caso do §10.13, que não passa por compose nenhum.
mkdir -p /tmp/www-local
printf '%s\n' "${FC_MARCADOR}-local" >/tmp/www-local/index.html
python3 -m http.server "$PORTA_LOCAL" --directory /tmp/www-local >/tmp/http-local.log 2>&1 &
pid_local=$!

aguardar_http() {
  local url="$1" tentativas=50
  while [ "$tentativas" -gt 0 ]; do
    if curl -sf --max-time 2 "$url" >/dev/null; then return 0; fi
    tentativas=$((tentativas - 1))
    sleep 0.2
  done
  echo "payload: ${url} não respondeu a tempo" >&2
  return 1
}

aguardar_http "http://localhost:${PORTA_LOCAL}/"
resposta_local=$(curl -sf "http://localhost:${PORTA_LOCAL}/")

if [ "$resposta_local" != "${FC_MARCADOR}-local" ]; then
  echo "payload: localhost:${PORTA_LOCAL} respondeu '${resposta_local}', não o marcador deste job" >&2
  exit 21
fi
echo "payload: localhost:${PORTA_LOCAL} -> ${resposta_local}"

# (2) Stack do aluno. O comando canônico vem pronto do `job.json`, com `-p`, o compose do aluno e o
# override — o agente da F3 vai recebê-lo do mesmo jeito e também não monta linha de compose à mão.
if [ -z "$comando" ]; then
  echo "payload: job.json sem comando canônico de compose" >&2
  exit 22
fi

derrubar_stack() {
  echo "payload: teardown camada 1 (§8)"
  eval "$comando down -v --remove-orphans" || true
  kill "$pid_local" 2>/dev/null || true
}
trap derrubar_stack EXIT

echo "payload: subindo a stack com ${comando}"
eval "$comando up -d"

aguardar_http "http://app:${PORTA_LOCAL}/"
resposta_stack=$(curl -sf "http://app:${PORTA_LOCAL}/")

if [ "$resposta_stack" != "${FC_MARCADOR}-via-compose" ]; then
  echo "payload: app:${PORTA_LOCAL} respondeu '${resposta_stack}', não o marcador deste job" >&2
  exit 23
fi
echo "payload: app:${PORTA_LOCAL} -> ${resposta_stack}"

# (3) Dossiê estático no formato do §7. A F2 não o valida (D5): quem plugar schema e retry
# corretivo é a F3 — aqui ele só precisa existir, ser JSON e ter o formato certo.
historico_nao_avaliado=$(jq -r '.shallow // false' /workspace/clone.json 2>/dev/null || echo false)

jq -n \
  --arg comando "$comando" \
  --arg projeto "$(jq -r '.compose_project' "$JOB_JSON")" \
  --arg marcador "$FC_MARCADOR" \
  --argjson historico_nao_avaliado "$historico_nao_avaliado" \
  '{
    schema_version: 1,
    veredito: "aprovado",
    motivo_inconclusivo: null,
    modo_avaliacao: "execucao",
    execucao: {
      executou: true,
      comandos_docker: [($comando + " up -d")],
      compose_project: $projeto,
      teardown_ok: true,
      container_name_fixo_no_compose: true,
      arquivos_auxiliares: [],
      observacoes: "dossiê estático do job fake da F2 — sem agente"
    },
    criterios: [{
      nome: "a stack sobe e responde por hostname",
      resultado: "ok",
      como_verificou: "executou",
      evidencia: ("curl http://app:8080/ -> " + $marcador + "-via-compose")
    }],
    delta_base: null,
    duvidas: [],
    devolutiva_rascunho: "Job fake da F2: nenhuma devolutiva real foi gerada.",
    historico_nao_avaliado: $historico_nao_avaliado
  }' >/workspace/dossie.json.parcial

mv /workspace/dossie.json.parcial /workspace/dossie.json
echo "payload: dossie.json escrito"
