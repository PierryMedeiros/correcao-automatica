# F8 — Pós-aprovação: multiusuário e web

> **Status:** ⬜ não iniciada — **esboço, não dimensionada** (plan §13: "dimensionar depois")
> **Estimativa:** a definir em F8.0
> **Depende de:** F7 (marco do MVP demonstrado)
> **Destrava:** nenhuma fase — é o fim da numeração prevista
> **Seções do plano:** §1 (não-objetivos) · §4 (auth do agente) · §11 (segurança e retenção) · §12 (métricas, backup) · §13 F8 · §15 · §17.7

## Objetivo

Tirar o sistema da máquina pessoal e das premissas que só valem lá: um usuário, um dono do Docker, egress
aberto, sem login. É a fase que paga as dívidas que o MVP contraiu conscientemente — nenhuma é descoberta
nova, todas estão nomeadas no plano. Não muda o que o sistema faz; muda onde e sob quais garantias roda.

## Pré-condições

- [ ] F7 marcada ✅ em `docs/fases/README.md` e demo aprovada pelo chefe (plan §13, marco pós-F7)
- [ ] Métricas de consumo por correção coletadas em operação real (§15, risco "custo surpresa") — sem elas D2 é palpite
- [ ] §17.7 resolvido: `SKILLS_DIR` fora de `.claude/` (hoje `/home/pierry/fullcycle/.claude/skills`, ver `docs/STATUS.md`) — em servidor, diretório de config de ferramenta não serve como dependência de runtime
- [ ] D1 respondida por quem opera o login da empresa e D2 decidida pelo chefe — sem elas F8.2 e F8.4 não têm desenho
- [ ] F8.0 concluída: fase dimensionada e este arquivo reescrito no formato pleno do template

## Decisões do plano que esta fase materializa

| Decisão | Onde está | Consequência prática nesta fase |
|---|---|---|
| Socket do Docker montado no runner e egress aberto: aceitos por necessidade no cenário local | §11 | As duas dívidas centrais da fase — socket vira proxy com allowlist no prefixo `fc-job-`, e endurecer rede é tirar rota para a rede local, não fechar a internet |
| Login e multiusuário são não-objetivos do MVP; `devolutivas.enviada_por` nasce null | §1, §5 | Auth preenche `enviada_por` daqui para frente; o histórico anterior fica sem autor, e isso é aceito |
| Retenção de job dirs (14d) e PII mínima foram calibradas para a máquina local | §11, §15 | Retenção revisada sob a regra da empresa, não sob a do notebook |
| Trocar CLI headless por API key é troca de variável de ambiente | §4, CLAUDE.md (`LlmExecutor`) | A fronteira já existe desde a F3; F8 exercita a troca, não a cria |
| Análises avançadas (tendências, exportação) ficam para cá; matéria-prima no banco desde o dia 1 | §12 | Nenhuma migration de coleta é necessária — é leitura sobre `correcoes`/`eventos` |

## Decisões a tomar nesta fase

| # | Pergunta em aberto | Opções | Recomendação |
|---|---|---|---|
| D1 | Auth reaproveita o login da empresa? | OIDC/SSO da empresa · auth local no Nest | Perguntar antes de desenhar; local só se o SSO tiver prazo incompatível |
| D2 | Credencial do agente | API key organizacional · plano dedicado | Decisão do chefe (§13 F8), embasada pelos números do §15 — não decidir sem eles |
| D3 | "1 run ativo por vez" sobrevive ao multiusuário? | Manter global · 1 por usuário · pool de slots | Manter global até haver medida real de contenção (§10.21 não muda de graça) |
| D4 | Janitor e backup seguem como cron do pg-boss dentro da API? | Manter · processo separado no host | Manter; a ressalva do §12 ("API parada = sem janitor") pesa menos com uptime de servidor |
| D5 | Modelo de permissões | Papel único · revisor + admin | Revisor + admin: quem revisa e envia ≠ quem configura run e mexe em `config` |
| D6 | Como o `SKILLS_DIR` chega ao servidor | Volume com clone do repo de skills + pull · bake na imagem | Volume + pull: skill é conteúdo com ciclo próprio (§4), não artefato de build |
| D7 | Escopo do socket proxy | Allowlist mínima (compose, inspect, network no prefixo `fc-job-`) · rootless/DinD | Allowlist primeiro; rootless é hipótese do §11 ("possivelmente"), não requisito |

## Etapas

**Não fatiadas.** Abaixo, os blocos candidatos na ordem provável e o que falta para cada um virar etapa
executável. Fatiá-los é a própria F8.0: detalhar hoje é planejar contra um host que ainda não existe.

### F8.0 — Dimensionar a fase
**Entrega:** este arquivo no formato pleno do template. **Falta:** as demais pré-condições acima.

### F8.1 — Deploy em host Linux com Docker
**Entrega:** sistema rodando fora da máquina pessoal (§13 F8, §15). **Falta:** host definido — muda rede, backup e retenção.

### F8.2 — Auth e permissões
**Entrega:** login, papéis e `devolutivas.enviada_por` preenchido de verdade (§1, §5). **Falta:** D1 e D5.

### F8.3 — Endurecimento do isolamento
**Entrega:** socket via proxy com allowlist e stacks de aluno sem rota para a rede local (§11). **Falta:** D7 e a rede do host de F8.1.

### F8.4 — Credencial organizacional do agente
**Entrega:** `LlmExecutor` na credencial de D2, sem mudança de régua. **Falta:** D2 e a suite golden G1–G10 verde como linha de base.

### F8.5 — Retenção revisada e métricas avançadas
**Entrega:** retenção sob a regra da empresa (§11) e tendências/exportação sobre os dados já coletados (§12). **Falta:** F8.1 e orientação sobre PII.

## Edge cases do §10 cobertos aqui

Nenhum caso novo. Quatro mudam de natureza ao sair da máquina local; revisá-los é entrega da F8.0.

| # | Caso | O que muda nesta fase | Onde é verificado |
|---|---|---|---|
| 10, 11 | Limite do plano / token expirado | Com API key organizacional (D2), a detecção muda de erro e a mensagem do §10.11 deixa de fazer sentido | Aceite a definir em F8.0 |
| 19, 28 | Disco enchendo · WSL suspende | Os limiares de 15/5 GB foram calibrados para o notebook; e a suspensão deixa de existir com F8.1 (o runbook perde a seção) | Aceite a definir em F8.0 |

## Critérios de aceite

Provisórios, derivados do §13 F8 e do §11; reescritos por F8.0. Até lá, o único aceite firme é A0.

| # | Critério | Como provar | Evidência esperada |
|---|---|---|---|
| A0 | Fase dimensionada | Este arquivo no formato pleno, com etapas, testes e estimativa | Diff do arquivo + estimativa registrada no `docs/STATUS.md` |
| A1 | Sistema roda fora da máquina pessoal | Fluxo de demo da F6 executado contra o host novo | Correção fim a fim concluída no host |
| A2 | Runner sem socket direto | Golden repo corrigido com o proxy no lugar do socket | Dossiê válido + `docker ps` do host sem container fora do prefixo `fc-job-` |
| A3 | Credencial organizacional sem mudança de régua, e envio com autor | Suite golden G1–G10 (F7) com a credencial de D2; envio por usuário logado | Vereditos idênticos aos da linha de base; `devolutivas.enviada_por` preenchido |

- [ ] A0
- [ ] A1
- [ ] A2
- [ ] A3

## Testes que nascem nesta fase

A definir em F8.0. Duas travas já são certas: a suite golden G1–G10 da F7 vira regressão da troca de
credencial (§15), e o endurecimento de rede exige um teste que prove as duas metades — stack de aluno sem
rota para a rede local e egress externo ainda funcionando (§11).

## Riscos e armadilhas

- **Endurecer rede vira falso reprovado.** Enunciados chamam API externa (§11 cita a AwesomeAPI do
  Client-Server-API); bloqueio largo demais chega como devolutiva ruim, não como erro de infraestrutura.
- **Socket proxy restritivo demais quebra o compose do aluno em silêncio:** a stack não sobe, o agente
  relata "não consegui executar" e o dossiê fica `inconclusivo` sem apontar a causa real.
- **Trocar credencial pode trocar o modelo junto** — o risco de maior impacto do §15; a suite golden roda
  antes de adotar, não depois. E PII sob regra de empresa pode invalidar os 14 dias de retenção do §11.

## O que NÃO entra nesta fase

- Integração ativa com a plataforma FC (webhook, drivers, envio automático) → F9
- Mudança na máquina de estados do §6 — estado novo exige atualizar o plano antes (regra dura 3)
- Mudança de critérios de correção ou de skills — é conteúdo com ciclo próprio (§4), nunca entrega de fase
- Refactor para o Claude Agent SDK (§4, alternativa aceitável) — só entra se D2 tornar obrigatório
- Multi-tenant e cobrança: o escopo é "mais de uma pessoa usa o mesmo sistema", nada além

## Impacto em fases seguintes

A preencher no encerramento da fase.

## Registro de execução

A preencher durante a fase.

- **Iniciada em:** AAAA-MM-DD
- **Concluída em:** AAAA-MM-DD
- **Decisões tomadas:**
- **Divergências do plano:**
- **Evidência dos aceites:**
