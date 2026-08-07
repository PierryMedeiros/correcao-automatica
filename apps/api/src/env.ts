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
