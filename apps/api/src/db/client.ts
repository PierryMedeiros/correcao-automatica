import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/client.js';

// O Prisma 7 exige driver adapter: a conexão é do `pg`, o Prisma só fala com ele. A URL entra por
// parâmetro (e não lida de `process.env` aqui dentro) porque quem chama decide contra qual banco
// abrir — seed e migration usam o de desenvolvimento, o harness de teste usa `banca_test` (D3).
export function criarPrisma(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export type { PrismaClient };
