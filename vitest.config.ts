import { defineConfig } from 'vitest/config';

// Dois projetos porque as exigências são diferentes: o de unidade não fala com nada; o de banco
// precisa de Postgres de pé e de migrations aplicadas em `banca_test`.
//
// `fileParallelism: false` mora aqui na raiz de propósito: é opção de execução, não de projeto —
// declarada dentro de um projeto ela é ignorada em silêncio. Sem ela, dois arquivos de banco rodam
// ao mesmo tempo contra a mesma database e o truncate de um apaga a fixture do outro no meio da
// asserção. É exatamente a "falha intermitente na unicidade" que a F1 antecipou nos riscos — e ela
// apareceu: `skills-map.test.ts` passava sozinho e falhava junto com `schema.test.ts`.
// O custo é desprezível: a suíte de unidade inteira roda em dezenas de milissegundos.
export default defineConfig({
  test: {
    fileParallelism: false,
    projects: [
      {
        test: {
          name: 'unidade',
          environment: 'node',
          include: ['tests/**/*.test.ts', 'packages/**/*.test.ts'],
        },
      },
      {
        // A raiz do projeto é `apps/api` porque é lá que moram `pg`, `prisma` e o client gerado —
        // o pnpm não hasteia dependência de pacote do workspace para a raiz do monorepo.
        //
        // Teste que mora em `apps/api` roda aqui, inclusive o que fica ao lado do código em
        // `src/**`: a regra é por pacote, não por natureza do teste. Um teste puro pagar o
        // `TRUNCATE` do harness custa milissegundos; um teste de banco cair no projeto errado
        // custa uma fixture apagada no meio da asserção, que foi o bug intermitente da F1.
        root: 'apps/api',
        test: {
          name: 'db',
          environment: 'node',
          include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
          globalSetup: ['tests/setup-db.ts'],
          setupFiles: ['tests/limpeza.ts'],
        },
      },
    ],
  },
});
