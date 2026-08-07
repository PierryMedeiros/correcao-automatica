#!/usr/bin/env bash
# Spike S2 (F0.5) — isolamento de rede por container.
#
# Prova a premissa do plan §2.4/§8/§10.13: dois runners servem na MESMA porta 8080 ao mesmo tempo
# sem colidir, porque cada container tem seu próprio namespace de rede. Se isso cair, a arquitetura
# precisa de alocação dinâmica de porta por job — mudança de §8, não conserto local.
#
# Uso: scripts/spikes/s2/run.sh
set -euo pipefail

readonly IMAGEM=busybox:1.36
readonly PORTA=8080

# busybox traz httpd e wget, não curl. Para o que o S2 mede — quem responde em localhost:8080
# dentro de cada netns — os dois clientes são equivalentes; a substituição está registrada em
# docs/spikes.md.
sobe_servidor() {
  local id="$1" marcador="$2"
  docker run -d \
    --name "fc-job-${id}" \
    --label "fc.job=${id}" \
    "$IMAGEM" \
    sh -c "mkdir -p /www && printf '%s\n' '${marcador}' > /www/index.html && httpd -f -p ${PORTA} -h /www" \
    >/dev/null
}

teardown() {
  # Limpeza por prefixo, como o janitor da F2 (plan §8) — nunca prune global (regra dura 1).
  docker ps -aq --filter 'name=^fc-job-s2' | xargs -r docker rm -f >/dev/null 2>&1 || true
}

falhou() {
  echo "FALHOU: $*" >&2
  exit 1
}

trap teardown EXIT
teardown

echo "== S2.1 — subindo fc-job-s2a e fc-job-s2b, ambos na ${PORTA}, sem -p e sem --network host"
sobe_servidor s2a MARCADOR-S2A
sobe_servidor s2b MARCADOR-S2B

# httpd sobe rápido, mas o `docker run` retorna antes do processo existir. Espera ativa curta,
# sem sleep fixo (teste determinístico não depende de temporização).
for tentativa in $(seq 1 50); do
  if docker exec fc-job-s2a wget -qO- "http://localhost:${PORTA}/" >/dev/null 2>&1 &&
    docker exec fc-job-s2b wget -qO- "http://localhost:${PORTA}/" >/dev/null 2>&1; then
    break
  fi
  [ "$tentativa" -eq 50 ] && falhou "os servidores não responderam dentro do limite"
  sleep 0.2
done

echo
echo "== S2.2 — cada container enxerga o PRÓPRIO processo em localhost:${PORTA}"
resposta_a=$(docker exec fc-job-s2a wget -qO- "http://localhost:${PORTA}/")
resposta_b=$(docker exec fc-job-s2b wget -qO- "http://localhost:${PORTA}/")
echo "  fc-job-s2a -> ${resposta_a}"
echo "  fc-job-s2b -> ${resposta_b}"
[ "$resposta_a" = "MARCADOR-S2A" ] || falhou "s2a respondeu '${resposta_a}', esperado MARCADOR-S2A"
[ "$resposta_b" = "MARCADOR-S2B" ] || falhou "s2b respondeu '${resposta_b}', esperado MARCADOR-S2B"
[ "$resposta_a" != "$resposta_b" ] || falhou "as duas respostas são iguais — namespace compartilhado"

echo
echo "== S2.3 — nenhum dos dois publicou porta no host"
porta_a=$(docker port fc-job-s2a || true)
porta_b=$(docker port fc-job-s2b || true)
echo "  docker port fc-job-s2a -> '${porta_a}'"
echo "  docker port fc-job-s2b -> '${porta_b}'"
[ -z "$porta_a" ] || falhou "fc-job-s2a publicou porta: ${porta_a}"
[ -z "$porta_b" ] || falhou "fc-job-s2b publicou porta: ${porta_b}"

echo
echo "== S2.4 — a ${PORTA} do host continua livre"
if curl -sf --max-time 3 "http://localhost:${PORTA}/" >/dev/null 2>&1; then
  falhou "o host respondeu na ${PORTA} — alguma coisa publicou a porta"
fi
echo "  curl http://localhost:${PORTA}/ do host -> falhou, como esperado"

echo
echo "== S2.5 — teardown por prefixo, sem prune"
teardown
sobrou=$(docker ps -a --filter 'name=^fc-job-s2' --format '{{.Names}}')
echo "  docker ps -a --filter 'name=^fc-job-s2' -> '${sobrou}'"
[ -z "$sobrou" ] || falhou "sobrou container após teardown: ${sobrou}"

echo
echo "S2 VERDE — netns por container elimina a colisão de porta (plan §10.13)."
