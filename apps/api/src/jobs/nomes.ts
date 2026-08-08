import { join } from 'node:path';

// Os nomes que o sistema dá ao que cria no Docker e no disco (plan §8, §11, §12, regra dura 2).
//
// Moram todos aqui porque três consumidores dependem de eles serem exatamente iguais: quem cria
// (Job Controller), quem derruba (teardown) e quem varre o que sobrou (janitor). Um prefixo
// divergindo do outro não quebra nada na hora — deixa recurso órfão que ninguém mais reconhece
// como seu, que é justamente o que a regra dura 1 impede de limpar no atacado.
//
// O `<id>` é sempre `correcoes.id` (D1 da F2): é ele que o §10.12 usa para achar correção órfã e
// o §11 para distinguir job dir órfão de referenciado.

export const PREFIXO_JOB = 'fc-job-';
export const LABEL_JOB = 'fc.job';

/** Quem rotula a stack do aluno é o compose, não nós (§8, spike S3, Apêndice B v1.6 item 2).
 *  Teardown e janitor varrem os **dois** labels: varrer só `fc.job` deixa a stack inteira órfã. */
export const LABEL_COMPOSE_PROJECT = 'com.docker.compose.project';

export function nomeDoRunner(correcaoId: string): string {
  return `${PREFIXO_JOB}${correcaoId}`;
}

/** Também é o `-p` do compose da stack do aluno, e é como ela é rotulada (§8, spike S3). */
export function projetoCompose(correcaoId: string): string {
  return `${PREFIXO_JOB}${correcaoId}`;
}

export function networkDoJob(correcaoId: string): string {
  return `${PREFIXO_JOB}${correcaoId}_net`;
}

export function labelDoJob(correcaoId: string): string {
  return `${LABEL_JOB}=${correcaoId}`;
}

export function labelDoProjetoCompose(correcaoId: string): string {
  return `${LABEL_COMPOSE_PROJECT}=${projetoCompose(correcaoId)}`;
}

/**
 * O caminho inverso: dado o nome de um recurso Docker, de que job ele é — se é de algum.
 *
 * É o que o janitor tem quando um recurso perdeu o label (criado por versão antiga, ou por uma
 * chamada que esqueceu de rotular): o §12 manda varrer por prefixo `fc-job-` também, e não só por
 * label. Devolve `null` para nome que não é nosso — e é esse `null` que impede o janitor de
 * remover container de terceiro só porque ele estava na listagem.
 */
export function correcaoIdDoNome(nome: string): string | null {
  if (!nome.startsWith(PREFIXO_JOB)) return null;

  const resto = nome.slice(PREFIXO_JOB.length);
  // `fc-job-<id>`, `fc-job-<id>_net` e os containers da stack (`fc-job-<id>-app-1`).
  const id = resto.split(/[_-]/)[0] ?? '';

  return id.length > 0 ? id : null;
}

export function caminhoDoJobDir(jobsDir: string, correcaoId: string): string {
  return join(jobsDir, correcaoId);
}
