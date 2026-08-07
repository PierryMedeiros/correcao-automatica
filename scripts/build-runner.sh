#!/usr/bin/env bash
# Builda a imagem do runner (plan §8, F2.1).
#
# O gid do grupo dono do socket do Docker é resolvido na hora e injetado no build: ele varia por
# máquina, e uma imagem buildada com o gid errado só falha quando o agente chama `docker` lá
# dentro — `permission denied` num ponto que não parece ter nada a ver com permissão (F0, S3).
# Por isso o gid nunca é fixado no Dockerfile nem no `.env`.
set -euo pipefail

raiz=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
socket=/var/run/docker.sock

if [ ! -S "$socket" ]; then
  echo "build-runner: ${socket} não existe. O Docker Engine está de pé?" >&2
  exit 1
fi

if [ -f "$raiz/.env" ]; then
  # shellcheck disable=SC1091
  set -a && . "$raiz/.env" && set +a
fi

if [ -z "${RUNNER_IMAGE:-}" ]; then
  echo "build-runner: RUNNER_IMAGE não está no .env da raiz (ex.: RUNNER_IMAGE=banca-runner:dev)." >&2
  exit 1
fi

docker_gid=$(stat -c %g "$socket")
echo "build-runner: ${RUNNER_IMAGE} com DOCKER_GID=${docker_gid}" >&2

docker build \
  --build-arg "DOCKER_GID=${docker_gid}" \
  -t "$RUNNER_IMAGE" \
  "$raiz/runner"

echo "build-runner: ${RUNNER_IMAGE} pronta" >&2
