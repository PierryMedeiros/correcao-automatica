import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { criarPrisma, type PrismaClient } from '../src/db/client.js';
import { databaseUrlTest } from '../src/env.js';

// Harness dos testes de acesso a dados (D3 da F1): database separada da de desenvolvimento, criada
// e migrada uma vez por execução do vitest. Teste nunca toca dado de dev, e nada aqui depende de
// passo manual — derrubar `banca_test` e rodar `pnpm test` tem que voltar a funcionar sozinho.

const raizDaApi = fileURLToPath(new URL('..', import.meta.url));
const prismaCli = fileURLToPath(new URL('../node_modules/.bin/prisma', import.meta.url));

let cliente: PrismaClient | undefined;

/** Client compartilhado pelos testes de banco. Aponta sempre para `banca_test`. */
export function prismaTeste(): PrismaClient {
  cliente ??= criarPrisma(databaseUrlTest());
  return cliente;
}

export async function desconectarPrismaTeste(): Promise<void> {
  await cliente?.$disconnect();
  cliente = undefined;
}

/**
 * Zera o banco entre testes. A lista de tabelas vem do próprio Postgres para não virar uma segunda
 * cópia do §5 que envelhece — tabela nova entra no truncate sem ninguém lembrar de atualizar isto.
 */
export async function limparBanco(): Promise<void> {
  const tabelas = await prismaTeste().$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tabelas.length === 0) return;

  const lista = tabelas.map((t) => `"${t.tablename}"`).join(', ');
  await prismaTeste().$executeRawUnsafe(`TRUNCATE TABLE ${lista} RESTART IDENTITY CASCADE`);
}

async function criarDatabaseSeFaltar(url: string): Promise<void> {
  const alvo = new URL(url);
  const nome = decodeURIComponent(alvo.pathname.slice(1));

  // Não dá para criar uma database estando conectado nela: a conexão administrativa vai na `postgres`.
  const administrativa = new URL(url);
  administrativa.pathname = '/postgres';

  const client = new Client({ connectionString: administrativa.toString() });
  try {
    await client.connect();
  } catch (erro) {
    throw new Error(
      `Não consegui falar com o Postgres em ${alvo.host}. Os testes de banco exigem o Postgres de ` +
        `desenvolvimento de pé: rode \`docker compose up -d\`. Erro original: ${(erro as Error).message}`,
    );
  }

  try {
    const existe = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [nome]);
    // CREATE DATABASE não aceita parâmetro; o nome vem do `.env` da própria máquina, não de fora.
    if (existe.rowCount === 0) await client.query(`CREATE DATABASE "${nome}"`);
  } finally {
    await client.end();
  }
}

/** `globalSetup` do vitest: roda uma vez, antes de qualquer arquivo de teste. */
export default async function prepararBancoDeTeste(): Promise<void> {
  const url = databaseUrlTest();
  await criarDatabaseSeFaltar(url);

  // As migrations são aplicadas pelo CLI de verdade, e não por SQL solto: é assim que o aceite A1
  // ("migrations sobem do zero") vale para o mesmo caminho que a máquina de produção vai usar.
  execFileSync(prismaCli, ['migrate', 'deploy'], {
    cwd: raizDaApi,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
