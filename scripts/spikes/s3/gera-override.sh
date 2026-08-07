#!/usr/bin/env bash
# Spike S3 — gera o override que o §8 descreve: remove `ports:` e `container_name:` de todos os
# serviços e aponta a network default do compose para a network externa do job.
#
# O override é GERADO, nunca editado à mão — é o que o Job Controller vai fazer na F2. Este script
# é protótipo descartável: o gerador de produção e seus testes são entrega da F2.
#
# Uso: gera-override.sh <compose-do-aluno> <nome-da-network> <arquivo-de-saida>
set -euo pipefail

compose_aluno="${1:?uso: gera-override.sh <compose-do-aluno> <network> <saida>}"
network="${2:?uso: gera-override.sh <compose-do-aluno> <network> <saida>}"
saida="${3:?uso: gera-override.sh <compose-do-aluno> <network> <saida>}"

# `docker compose config --services` resolve o arquivo do aluno e devolve os nomes dos serviços,
# o que evita depender de yq só para ler uma lista.
servicos=$(docker compose -f "$compose_aluno" config --services)
[ -n "$servicos" ] || {
  echo "gera-override: nenhum serviço em ${compose_aluno}" >&2
  exit 1
}

{
  echo "# GERADO por scripts/spikes/s3/gera-override.sh — não editar à mão."
  echo "services:"
  while IFS= read -r servico; do
    [ -z "$servico" ] && continue
    printf '  %s:\n' "$servico"
    # Merge de lista em Compose CONCATENA: `ports: []` puro não remove porta nenhuma.
    # A tag `!reset` (Compose >= 2.24) é o que de fato apaga o campo do arquivo base.
    printf '    ports: !reset []\n'
    printf '    container_name: !reset null\n'
  done <<<"$servicos"
  echo "networks:"
  echo "  default:"
  printf '    name: %s\n' "$network"
  echo "    external: true"
} >"$saida"

echo "gera-override: ${saida} gerado para $(wc -l <<<"$servicos") serviço(s)" >&2
