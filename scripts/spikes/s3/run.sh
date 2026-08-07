#!/usr/bin/env bash
# Spike S3 (F0.6) — compose sem portas publicadas + network externa pré-criada.
#
# Prova a topologia exata do §8: o override gerado remove `ports:` e `container_name:` de todos os
# serviços do aluno, aponta a network default para uma externa criada ANTES do runner, e o runner
# alcança o serviço por hostname — nunca por porta de host. Cobre os edge cases §10.14, §10.15 e
# olha de propósito para o §10.16 (bind mount relativo).
#
# A ordem network -> runner -> connect -> stack é obrigatória (Apêndice B, 06/08 item 1): é ela que
# elimina a corrida de a stack nascer antes de a network existir.
#
# Uso: scripts/spikes/s3/run.sh
set -euo pipefail

readonly ID=s3
readonly RUNNER="fc-job-${ID}"
readonly NETWORK="fc-job-${ID}_net"
readonly PROJETO="fc-job-${ID}"
readonly IMAGEM="banca-spike-s3:dev"

raiz=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
aqui="${raiz}/scripts/spikes/${ID}"

falhou() {
  echo "FALHOU: $*" >&2
  exit 1
}

[ -f "${raiz}/.env" ] || falhou ".env não existe — copie de .env.example"
jobs_dir=$(grep -E '^JOBS_DIR=' "${raiz}/.env" | cut -d= -f2-)
[ -n "$jobs_dir" ] || falhou "JOBS_DIR vazio no .env"
job_dir="${jobs_dir}/${ID}"

teardown() {
  # Teardown em camadas do §8, na ordem: stack -> runner -> network. Tudo escopado ao job;
  # prune global é regra dura 1 e está bloqueado por guard.
  docker compose -p "$PROJETO" down -v --remove-orphans >/dev/null 2>&1 || true
  docker ps -aq --filter "label=com.docker.compose.project=${PROJETO}" | xargs -r docker rm -f >/dev/null 2>&1 || true
  docker rm -f "$RUNNER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}

trap teardown EXIT
teardown

echo "== S3.0 — build do stand-in do runner, com o gid do socket do host injetado"
docker_gid=$(stat -c '%g' /var/run/docker.sock)
echo "  gid do /var/run/docker.sock no host: ${docker_gid}"
docker build --quiet --build-arg "DOCKER_GID=${docker_gid}" -t "$IMAGEM" "$aqui" >/dev/null
echo "  ${IMAGEM} pronta"

echo
echo "== S3.1 — job dir e compose do aluno"
rm -rf "$job_dir"
mkdir -p "${job_dir}/dados"
cp "${aqui}/compose-aluno.yml" "${job_dir}/compose-aluno.yml"
printf 'este arquivo existe no HOST, em %s/dados\n' "$job_dir" >"${job_dir}/dados/marcador-do-host.txt"
echo "  ${job_dir} preparado"

echo
echo "== S3.2 — gerando o override (nunca editado à mão)"
"${aqui}/gera-override.sh" "${job_dir}/compose-aluno.yml" "$NETWORK" "${job_dir}/compose.override.yml"
echo "--- ${job_dir}/compose.override.yml ---"
cat "${job_dir}/compose.override.yml"
echo "---"

echo
echo "== S3.3 — network PRIMEIRO, depois runner, depois connect"
docker network create --label "fc.job=${ID}" "$NETWORK" >/dev/null
echo "  network ${NETWORK} criada"

docker run -d \
  --name "$RUNNER" \
  --label "fc.job=${ID}" \
  -v "${job_dir}:/workspace" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  "$IMAGEM" \
  sleep infinity >/dev/null
echo "  runner ${RUNNER} de pé"

docker network connect "$NETWORK" "$RUNNER"
echo "  runner conectado a ${NETWORK}"

echo
echo "== S3.4 — o não-root fala com o daemon pelo socket montado (armadilha do gid, §8)"
docker exec "$RUNNER" sh -c 'id && docker version --format "{{.Server.Version}}"' ||
  falhou "o usuário corrector não conseguiu falar com o daemon — gid do socket errado"

echo
echo "== S3.5 — subindo a stack do aluno de DENTRO do runner"
docker exec -w /workspace "$RUNNER" \
  docker compose -p "$PROJETO" -f compose-aluno.yml -f compose.override.yml up -d app db ||
  falhou "a stack não subiu"

for tentativa in $(seq 1 50); do
  docker exec "$RUNNER" curl -sf --max-time 3 http://app:8080/ >/dev/null 2>&1 && break
  [ "$tentativa" -eq 50 ] && falhou "o serviço app não respondeu por hostname dentro do limite"
  sleep 0.2
done

echo
echo "== S3.6 — alcance por HOSTNAME de dentro do runner, nunca por porta de host"
resposta=$(docker exec "$RUNNER" curl -sf http://app:8080/)
echo "  curl http://app:8080/ -> ${resposta}"
[ "$resposta" = "S3-APP-OK" ] || falhou "resposta inesperada de app: '${resposta}'"

echo
echo "== S3.7 — zero porta publicada no host"
docker compose -p "$PROJETO" ps 2>/dev/null || true
publicadas=""
for c in $(docker ps -q --filter "label=com.docker.compose.project=${PROJETO}"); do
  nome=$(docker inspect -f '{{.Name}}' "$c")
  porta=$(docker port "$c" || true)
  echo "  docker port ${nome#/} -> '${porta}'"
  [ -n "$porta" ] && publicadas="${publicadas} ${nome}"
done
[ -z "$publicadas" ] || falhou "container(s) publicaram porta:${publicadas}"

if curl -sf --max-time 3 http://localhost:8080/ >/dev/null 2>&1; then
  falhou "o host respondeu na 8080 — a stack publicou porta"
fi
echo "  a 8080 do host continua livre"

echo
echo "== S3.8 — o container_name: fixo do aluno não pegou (§10.15)"
for fixo in desafio-app desafio-db; do
  achou=$(docker ps -a --filter "name=^${fixo}$" --format '{{.Names}}')
  echo "  docker ps -a --filter name=^${fixo}\$ -> '${achou}'"
  [ -z "$achou" ] || falhou "o container_name fixo '${fixo}' foi respeitado — o override não removeu"
done
echo "  containers da stack:"
docker ps --filter "label=com.docker.compose.project=${PROJETO}" --format '    {{.Names}}'

echo
echo "== S3.9 — onde um bind mount relativo do aluno resolve (§10.16 / fixture G9)"
origem=$(docker exec -w /workspace "$RUNNER" \
  docker compose -p "$PROJETO" -f compose-aluno.yml -f compose.override.yml config |
  grep -A3 'source:' | grep -m1 'source:' | awk '{print $2}')
echo "  o compose resolveu o './dados' do serviço probe para: ${origem}"
if [ -e "$origem" ]; then
  echo "  esse caminho EXISTE no host — bind mount relativo resolveria certo"
else
  echo "  esse caminho NÃO existe no host, onde o daemon está: o daemon criaria um diretório"
  echo "  vazio nesse caminho e o aluno veria /dados sem os arquivos dele."
  echo "  (o serviço probe não é subido de propósito, para não deixar lixo no / do host)"
fi

echo
echo "== S3.10 — teardown em camadas e limpeza sem prune"
teardown
sobrou_container=$(docker ps -aq --filter "label=fc.job=${ID}")
sobrou_stack=$(docker ps -aq --filter "label=com.docker.compose.project=${PROJETO}")
sobrou_network=$(docker network ls --filter "label=fc.job=${ID}" --format '{{.Name}}')
echo "  containers com label fc.job=${ID} -> '${sobrou_container}'"
echo "  containers da stack ${PROJETO}    -> '${sobrou_stack}'"
echo "  networks com label fc.job=${ID}   -> '${sobrou_network}'"
[ -z "$sobrou_container" ] || falhou "sobrou container com label fc.job=${ID}"
[ -z "$sobrou_stack" ] || falhou "sobrou container da stack ${PROJETO}"
[ -z "$sobrou_network" ] || falhou "sobrou network com label fc.job=${ID}"

echo
echo "S3 VERDE — topologia do §8 confirmada: override gerado, network externa, acesso por hostname."
