# Spike S1 — imagem descartável (F0 D3).
# A imagem definitiva do runner é entrega da F2 (plan §8), escrita do zero: aqui só existe o mínimo
# para medir o risco nº 1 do projeto, que é `claude -p` rodar headless dentro de container. Sem Go,
# PHP ou Python — toolchain de aluno é assunto da F2.
FROM ubuntu:24.04

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git jq \
  && rm -rf /var/lib/apt/lists/*

# Node 22 é a versão do runner do §8 — toolchain de aluno, sem relação com o Node 24 do host.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

# ubuntu:24.04 já ocupa o uid 1000 com o usuário `ubuntu`; sem removê-lo antes, o `corrector`
# do §8 não nasce no uid que o job dir montado espera. Aprendizado que a F2 herda.
RUN userdel -r ubuntu && useradd -m -u 1000 -s /bin/bash corrector

USER corrector
WORKDIR /workspace
