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

export function caminhoDoJobDir(jobsDir: string, correcaoId: string): string {
  return join(jobsDir, correcaoId);
}
