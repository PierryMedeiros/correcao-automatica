# Imagem do runner (plan §8): um container por correção, onde o agente clona o repo do aluno,
# sobe a stack dele pelo socket do host e escreve o dossiê. Toolchain de aluno, não do sistema —
# o Node daqui é 22 e não tem relação com o Node 24 do host (`.nvmrc`).
#
# Versões pinadas de propósito: a régua da correção tem que ser a mesma na terça e no mês que vem
# (§14). Subir qualquer uma delas é decisão, não consequência de rebuildar.
FROM ubuntu:24.04

ARG DOCKER_GID
ARG GO_VERSION=1.26.5
ARG GO_SHA256=5c2c3b16caefa1d968a94c1daca04a7ca301a496d9b086e17ad77bb81393f053
ARG CLAUDE_CODE_VERSION=2.1.224

ENV DEBIAN_FRONTEND=noninteractive
ENV PATH=/usr/local/go/bin:$PATH

# Base + toolchains que vêm do apt do Ubuntu 24.04 (PHP 8.3 e Python 3.12 são os do repositório
# oficial da distro, então não há PPA para pinar).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    gnupg \
    jq \
    unzip \
    php8.3-cli \
    php8.3-curl \
    php8.3-mbstring \
    php8.3-xml \
    python3.12 \
    python3-pip \
    python3-venv \
  && rm -rf /var/lib/apt/lists/*

# Docker CLI + plugin de compose: é por eles que o agente sobe a stack do aluno no daemon do host
# (socket montado, §8). O daemon NÃO roda aqui dentro.
RUN install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc \
  && chmod a+r /etc/apt/keyrings/docker.asc \
  && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" \
    > /etc/apt/sources.list.d/docker.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

# Go vem de tarball com sha256 conferido: o apt do Ubuntu carrega uma versão antiga demais para os
# desafios, e baixar sem conferir o hash seria confiar na rede do build.
RUN curl -fsSLo /tmp/go.tar.gz "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" \
  && echo "${GO_SHA256}  /tmp/go.tar.gz" | sha256sum -c - \
  && tar -C /usr/local -xzf /tmp/go.tar.gz \
  && rm /tmp/go.tar.gz

RUN curl -fsSLo /tmp/composer-setup.php https://getcomposer.org/installer \
  && php8.3 /tmp/composer-setup.php --install-dir=/usr/local/bin --filename=composer \
  && rm /tmp/composer-setup.php

RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"

# Duas armadilhas medidas na F0 (docs/spikes.md, "O que a F2 e a F3 herdam"):
#   1. `ubuntu:24.04` já ocupa o uid 1000 com o usuário `ubuntu` — sem removê-lo, o `corrector` não
#      nasce no uid que o job dir montado espera, e o runner não consegue escrever o dossiê.
#   2. o gid do grupo dono do socket varia por máquina (989 nesta): sem ele, o não-root leva
#      `permission denied` ao falar com o daemon, e o erro só aparece quando o agente roda `docker`.
# `sudo` não é instalado de propósito (§11): o runner nasce com a permissão de que precisa.
RUN if [ -z "${DOCKER_GID}" ]; then echo "DOCKER_GID é obrigatório (use scripts/build-runner.sh)" >&2; exit 1; fi \
  && userdel -r ubuntu \
  && useradd -m -u 1000 -s /bin/bash corrector \
  && if getent group "${DOCKER_GID}" >/dev/null; then \
       usermod -aG "$(getent group "${DOCKER_GID}" | cut -d: -f1)" corrector; \
     else \
       groupadd -g "${DOCKER_GID}" dockerhost && usermod -aG dockerhost corrector; \
     fi

COPY entrypoint.sh /usr/local/bin/fc-entrypoint
RUN chmod 0755 /usr/local/bin/fc-entrypoint

USER corrector
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/fc-entrypoint"]
