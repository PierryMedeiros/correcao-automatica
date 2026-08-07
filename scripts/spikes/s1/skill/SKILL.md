---
name: spike-s1
description: Skill sintética do spike S1 do projeto Banca. Não corrige desafio nenhum — existe para provar que o agente headless leu um arquivo montado :ro e seguiu a instrução ao pé da letra.
---

# Skill do spike S1

Esta skill não avalia desafio nenhum e não tem critério de correção. Ela existe para provar, dentro
do container, que o agente headless leu **este arquivo** — montado `:ro` em `/workspace/skill`,
como o Job Controller monta a skill real (plan §8) — e seguiu a instrução literalmente.

## O que fazer

1. Conte as linhas de `/workspace/repo/ALVO.txt` com o tool Bash: `wc -l < /workspace/repo/ALVO.txt`.
2. Escreva `/workspace/out.json` com **exatamente** estes três campos, e nada além deles:
   - `linhas_alvo` — o número inteiro contado no passo 1
   - `marcador_literal` — o valor da linha `MARCADOR_LITERAL=` da seção abaixo, copiado
     **literalmente**: sem traduzir, encurtar, reescrever, corrigir pontuação ou trocar acento
   - `arquivo_lido` — o caminho absoluto do arquivo que você contou

O arquivo tem que ser JSON válido. Não escreva mais nada em `/workspace`.

## Marcador literal

MARCADOR_LITERAL=tordilho-42-sem-graxa: o pangaré confere o dossiê às quintas-feiras
