#!/usr/bin/env bash
# Entrypoint do runner (plan §8, §9.2 passo 4). É o PID 1 do container `fc-job-<id>`.
#
# Contrato com o Job Controller, todo ele em arquivos do job dir:
#   job.json       (entrada) — dados do job, escritos pelo host ANTES do `docker create`
#   runner.log     (saída)   — tudo que este script imprime (§12)
#   clone.json     (saída)   — como o clone terminou; é a origem do §10.17 e do §10.18
#   resultado.json (saída)   — MARCADOR DE FIM
#   encerrar       (entrada) — sentinela que manda o runner sair
#
# `resultado.json` é o marcador porque o container **não morre** quando a carga termina (§8,
# plano v1.5): o retry corretivo do §7 é um `docker exec` + `claude --resume` no runner ainda de
# pé, e um entrypoint que saísse junto com a carga mataria esse mecanismo por construção. Quem
# derruba o runner é sempre o host — inclusive quando o clone falha.
set -euo pipefail

readonly WORKSPACE=/workspace
readonly LOG="$WORKSPACE/runner.log"
readonly JOB_JSON="$WORKSPACE/job.json"
readonly MARCADOR="$WORKSPACE/resultado.json"
readonly CLONE_INFO="$WORKSPACE/clone.json"
readonly SENTINELA="$WORKSPACE/encerrar"
readonly REPO="$WORKSPACE/repo"

# Códigos de saída próprios do runner, para o motivo da falha chegar ao `correcoes.erro_resumo`
# sem depender de parsear log. Ficam acima de 63 para não colidir com código de carga.
readonly COD_JOB_JSON=64
readonly COD_CLONE=65
readonly COD_CHECKOUT=66
readonly COD_PAYLOAD_AUSENTE=67
readonly COD_INESPERADO=70

# `tee` mantém o log no job dir (§12) sem cegar o `docker logs`, que é o que se tem à mão quando
# o job dir ainda não está acessível. O código de saída preservado é o do script, não o do tee.
exec > >(tee -a "$LOG") 2>&1

encerrar_solicitado=0
trap 'encerrar_solicitado=1' TERM INT
trap 'ao_erro_inesperado $? $LINENO' ERR

agora() { date -u +%Y-%m-%dT%H:%M:%SZ; }

log() { printf '[%s] %s\n' "$(agora)" "$*"; }

# Escrita atômica: o host faz polling deste arquivo e não pode ler um JSON pela metade (F2.5).
escrever_marcador() {
  local codigo="$1" motivo="$2"
  jq -n \
    --argjson exit_code "$codigo" \
    --arg finished_at "$(agora)" \
    --arg motivo "$motivo" \
    '{exit_code: $exit_code, finished_at: $finished_at, motivo: $motivo}' >"$MARCADOR.parcial"
  mv "$MARCADOR.parcial" "$MARCADOR"
  log "marcador escrito: exit_code=${codigo} motivo=${motivo}"
}

# `clone.json` é escrito SEMPRE, e não só no caminho degradado: o gatilho do §10.17 é do backend
# (D7) e ler "shallow: false" é mais barato do que distinguir arquivo ausente de clone que nem
# chegou a acontecer.
escrever_clone_info() {
  local shallow="$1" motivo="$2" submodules_ok="$3" submodules_erro="$4"
  jq -n \
    --argjson shallow "$shallow" \
    --arg motivo "$motivo" \
    --argjson submodules_ok "$submodules_ok" \
    --arg submodules_erro "$submodules_erro" \
    '{shallow: $shallow,
      motivo: (if $motivo == "" then null else $motivo end),
      submodules: {ok: $submodules_ok,
                   erro: (if $submodules_erro == "" then null else $submodules_erro end)}}' \
    >"$CLONE_INFO.parcial"
  mv "$CLONE_INFO.parcial" "$CLONE_INFO"
}

aguardar_encerramento() {
  log "aguardando o sinal do Job Controller (arquivo ${SENTINELA} ou SIGTERM)"
  while [ "$encerrar_solicitado" -eq 0 ] && [ ! -e "$SENTINELA" ]; do
    # `sleep` em background + `wait` para o trap de SIGTERM rodar na hora, e não só depois que o
    # sleep terminar — é a diferença entre o teardown levar 1s e levar o grace inteiro do docker.
    sleep 1 &
    wait $! || true
  done
  log "sinal recebido; encerrando o runner"
}

# Falhar sem marcador deixaria o job só saindo por timeout do host (§10.9), com `erro_resumo`
# dizendo "estourou o limite" para um erro que não tem nada a ver com tempo.
ao_erro_inesperado() {
  local codigo="$1" linha="$2"
  set +e
  trap - ERR
  log "ERRO INESPERADO na linha ${linha} (código ${codigo})"
  escrever_marcador "$COD_INESPERADO" "erro_inesperado_linha_${linha}"
  aguardar_encerramento
  exit "$COD_INESPERADO"
}

# Encerra o job pelo caminho previsto: marcador + espera. Nunca `exit` seco.
encerrar_com() {
  local codigo="$1" motivo="$2"
  set +e
  trap - ERR
  escrever_marcador "$codigo" "$motivo"
  aguardar_encerramento
  exit "$codigo"
}

cd "$WORKSPACE"
log "runner do job ${FC_JOB_ID:-<sem FC_JOB_ID>} de pé como $(id -un) (uid $(id -u))"

if [ -z "${FC_JOB_ID:-}" ] || [ ! -f "$JOB_JSON" ] || ! jq -e . "$JOB_JSON" >/dev/null 2>&1; then
  log "job.json ausente ou inválido em ${JOB_JSON}, ou FC_JOB_ID não definido"
  encerrar_com "$COD_JOB_JSON" "job_json_invalido"
fi

repo_url=$(jq -r '.repo_url // ""' "$JOB_JSON")
commit_sha=$(jq -r '.commit_sha // ""' "$JOB_JSON")
clone_timeout="${FC_CLONE_TIMEOUT_S:-120}"

if [ -z "$repo_url" ]; then
  log "job.json não traz repo_url"
  encerrar_com "$COD_JOB_JSON" "repo_url_ausente"
fi

log "clonando ${repo_url} (timeout ${clone_timeout}s)"
shallow=false
motivo_shallow=""

# `FC_CLONE_TIMEOUT_S=0` pula o clone completo e vai direto ao shallow. Existe para o operador
# forçar o caminho degradado num repo sabidamente gigante — e é o que torna o §10.17 testável sem
# depender de cronômetro (o `timeout` do GNU trata 0 como "sem limite", então o caso é tratado aqui).
if [ "$clone_timeout" = "0" ]; then
  log "clone completo desativado por FC_CLONE_TIMEOUT_S=0; indo direto ao shallow"
  clone_completo_ok=1
else
  clone_completo_ok=0
  timeout "$clone_timeout" git clone --quiet "$repo_url" "$REPO" || clone_completo_ok=$?
fi

if [ "$clone_completo_ok" -ne 0 ]; then
  # 124 é o código com que o `timeout` mata o comando: é o §10.17 literal. Qualquer outro código é
  # falha do próprio clone, e a segunda tentativa rasa vale do mesmo jeito — repo grande demais
  # costuma estourar antes por rede, não por relógio.
  if [ "$clone_timeout" = "0" ]; then
    motivo_shallow="clone_completo_desativado"
  elif [ "$clone_completo_ok" -eq 124 ]; then
    motivo_shallow="timeout_${clone_timeout}s"
  else
    motivo_shallow="erro_no_clone_completo_${clone_completo_ok}"
  fi

  log "clone completo não concluiu (${motivo_shallow}); tentando --depth 1 (§10.17)"
  rm -rf "$REPO"

  timeout_raso="$clone_timeout"
  if [ "$timeout_raso" = "0" ]; then timeout_raso=120; fi

  clone_raso_ok=0
  timeout "$timeout_raso" git clone --quiet --depth 1 "$repo_url" "$REPO" || clone_raso_ok=$?

  if [ "$clone_raso_ok" -ne 0 ]; then
    log "clone raso também falhou (código ${clone_raso_ok})"
    escrever_clone_info false "falha_no_clone_${clone_raso_ok}" true ""
    encerrar_com "$COD_CLONE" "clone_falhou"
  fi

  shallow=true
  log "clone raso concluído: histórico NÃO avaliado (§10.17)"
fi

if [ -n "$commit_sha" ]; then
  log "checkout de ${commit_sha}"
  checkout_ok=0
  git -C "$REPO" checkout --quiet "$commit_sha" 2>/dev/null || checkout_ok=$?

  # Clone raso traz só a ponta: o SHA pinado no intake pode não estar nele. Buscar o objeto
  # avulso é mais barato que desistir do job — e mantém a régua do §9.2 (avalia-se o SHA pinado).
  if [ "$checkout_ok" -ne 0 ] && [ "$shallow" = true ]; then
    log "SHA fora do clone raso; buscando o objeto avulso"
    if git -C "$REPO" fetch --quiet --depth 1 origin "$commit_sha" 2>/dev/null; then
      checkout_ok=0
      git -C "$REPO" checkout --quiet FETCH_HEAD 2>/dev/null || checkout_ok=$?
    fi
  fi

  if [ "$checkout_ok" -ne 0 ]; then
    log "commit ${commit_sha} não existe no clone"
    escrever_clone_info "$shallow" "$motivo_shallow" true ""
    encerrar_com "$COD_CHECKOUT" "commit_sha_inexistente"
  fi
else
  log "job.json sem commit_sha: seguindo no ref default do clone"
fi

# Submodule quebrado é problema do repo do aluno, não do runner: o job segue e o registro vai para
# o dossiê pelo `clone.json` (§10.18).
submodules_ok=true
submodules_erro=""
if [ -f "$REPO/.gitmodules" ]; then
  log "inicializando submodules"
  if ! saida_submodule=$(git -C "$REPO" submodule update --init --recursive 2>&1); then
    submodules_ok=false
    submodules_erro=$(printf '%s' "$saida_submodule" | tail -3 | tr '\n' ' ')
    log "submodules falharam, seguindo assim mesmo (§10.18): ${submodules_erro}"
  fi
fi

escrever_clone_info "$shallow" "$motivo_shallow" "$submodules_ok" "$submodules_erro"
log "repo pronto em ${REPO} (shallow=${shallow}, submodules_ok=${submodules_ok})"

# Seam da carga (D4): vazio na F2, preenchido pela F3 com a invocação do `claude -p`. O runner não
# sabe o que executa — é o que permite a F2 rodar job fim a fim sem gastar um agente.
if [ -z "${FC_PAYLOAD_CMD:-}" ]; then
  log "FC_PAYLOAD_CMD não definida: não há carga para executar neste job"
  encerrar_com "$COD_PAYLOAD_AUSENTE" "payload_ausente"
fi

log "executando a carga: ${FC_PAYLOAD_CMD}"
# `|| codigo=$?` e não `set +e`: desligar o errexit NÃO desliga o trap de ERR, e a carga que
# termina com código != 0 é desfecho previsto (o §7 espera exit code do agente), não acidente.
codigo_da_carga=0
bash -c "$FC_PAYLOAD_CMD" || codigo_da_carga=$?
log "carga terminou com código ${codigo_da_carga}"

encerrar_com "$codigo_da_carga" "carga_concluida"
