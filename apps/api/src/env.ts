import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// O `.env` mora na raiz do monorepo — um arquivo por máquina, não por pacote. Ancorar o caminho
// neste módulo é o que faz seed, migration e teste acharem o arquivo independente do cwd de quem
// os chamou, e o cwd varia mesmo: `pnpm --filter` roda em `apps/api`, o vitest roda na raiz.
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

function exigir(nome: string): string {
  const valor = process.env[nome]?.trim();
  if (!valor) {
    throw new Error(
      `${nome} não está definida. Copie .env.example para .env na raiz do repositório e preencha.`,
    );
  }
  return valor;
}

export function databaseUrl(): string {
  return exigir('DATABASE_URL');
}

// `prisma generate` não conecta em banco nenhum e precisa funcionar em máquina recém-clonada,
// antes de existir `.env`. Só quem conecta de fato exige a variável.
export function databaseUrlOpcional(): string | undefined {
  return process.env['DATABASE_URL']?.trim() || undefined;
}

// Banco separado do de desenvolvimento (D3 da F1): teste nunca toca dado de dev.
export function databaseUrlTest(): string {
  return exigir('DATABASE_URL_TEST');
}

/** Diretório das skills `corrige-*`, fora da árvore do repo (§4). Montado `:ro` no runner (§8). */
export function skillsDir(): string {
  return exigir('SKILLS_DIR');
}

/** Raiz dos job dirs (§8, §11): um subdiretório por `correcoes.id`. */
export function jobsDir(): string {
  return exigir('JOBS_DIR');
}

export function runnerImage(): string {
  return exigir('RUNNER_IMAGE');
}

/**
 * Só confirma a presença do token — nunca devolve o valor.
 *
 * O runner o recebe por `-e CLAUDE_CODE_OAUTH_TOKEN` sem `=valor`, que faz o Docker copiá-lo do
 * ambiente do processo: assim o segredo não passa pela linha de comando (onde qualquer `ps` o
 * leria) nem por variável nossa que pudesse acabar em log (regra dura 5).
 */
export function tokenClaudePresente(): boolean {
  return (process.env['CLAUDE_CODE_OAUTH_TOKEN']?.trim().length ?? 0) > 0;
}
