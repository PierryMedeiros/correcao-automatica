import { defineConfig } from 'prisma/config';
import { databaseUrlOpcional } from './src/env.js';

// O Prisma 7 não lê `.env` sozinho e resolve caminhos a partir deste arquivo. `src/env.ts` carrega
// o `.env` da raiz do monorepo (um arquivo por máquina, não por pacote) — ver o comentário de lá.
// A URL entra como opcional de propósito: `prisma generate` não fala com o banco e precisa rodar em
// máquina recém-clonada, sem `.env`. Quem exige a variável é o comando que de fato conecta.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed/index.ts',
  },
  datasource: {
    url: databaseUrlOpcional(),
  },
});
