# Spike S3 — stand-in do runner. Descartável, como o do S1 (F0 D3): a imagem definitiva é entrega
# da F2 (plan §8) e nasce do zero. Aqui só o necessário para provar a topologia do §8 — docker CLI
# + compose plugin + curl, rodando como usuário NÃO-ROOT no grupo do socket do host.
#
# Roda como não-root de propósito: é a configuração do §8, e é o que expõe a armadilha do gid do
# socket. Rodar como root "só para testar" mediria outra coisa.
FROM ubuntu:24.04

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc \
  && chmod a+r /etc/apt/keyrings/docker.asc \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" \
       > /etc/apt/sources.list.d/docker.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
  && rm -rf /var/lib/apt/lists/*

# gid do grupo `docker` do HOST, injetado no build (§8). Sem ele o usuário não-root leva
# "permission denied" ao falar com o daemon pelo socket montado — e o erro não parece de permissão.
ARG DOCKER_GID=999
RUN if getent group "${DOCKER_GID}" >/dev/null; then \
      groupmod -n dockerhost "$(getent group "${DOCKER_GID}" | cut -d: -f1)"; \
    else \
      groupadd -g "${DOCKER_GID}" dockerhost; \
    fi

# ubuntu:24.04 já ocupa o uid 1000 com o usuário `ubuntu` — mesmo achado do S1.
RUN userdel -r ubuntu && useradd -m -u 1000 -G dockerhost -s /bin/bash corrector

USER corrector
WORKDIR /workspace
