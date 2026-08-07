import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarPrisma } from '../../src/db/client.js';
import { databaseUrl } from '../../src/env.js';
import { lerSkillsMap } from './csv.js';
import { semearConfig } from './config.js';
import { semearSkillsMap } from './skills-map.js';

// `pnpm db:seed`. Carrega o `skills_map` a partir do CSV e os defaults operacionais de `config`.
// Aceita um caminho de CSV como argumento — é assim que o aceite A5 prova a recusa com um arquivo
// mutilado sem mexer no arquivo de verdade.

const CSV_PADRAO = fileURLToPath(new URL('../../../../docs/skills-map.csv', import.meta.url));

function ler(caminho: string): string {
  try {
    return readFileSync(caminho, 'utf8');
  } catch (erro) {
    throw new Error(`não consegui ler o CSV em ${caminho}: ${(erro as Error).message}`);
  }
}

// `pnpm db:seed` delega para `apps/api`, então o cwd do processo é `apps/api` e não o diretório em
// que o comando foi digitado. Caminho relativo passado pelo usuário tem que valer a partir de onde
// ele está — e `INIT_CWD`, que o pnpm preenche, é o único lugar que sabe disso.
function caminhoDoArgumento(argumento: string): string {
  return resolve(process.env['INIT_CWD'] ?? process.cwd(), argumento);
}

async function main(): Promise<void> {
  const argumento = process.argv[2];
  const caminho = argumento === undefined ? CSV_PADRAO : caminhoDoArgumento(argumento);
  const { registros, problemas } = lerSkillsMap(ler(caminho));

  // Validação do arquivo inteiro antes de qualquer escrita (D6 da F1): havendo recusa, o banco não
  // é tocado e TODOS os problemas são listados de uma vez — corrigir um por execução seria cruel
  // com quem edita 48 linhas à mão.
  if (problemas.length > 0) {
    console.error(
      `${caminho}: ${problemas.length} problema(s) — nada foi escrito no banco.\n` +
        problemas.map((problema) => `  ${problema}`).join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  const prisma = criarPrisma(databaseUrl());
  try {
    const mapa = await semearSkillsMap(prisma, registros);
    const config = await semearConfig(prisma);

    console.log(
      `skills_map: ${mapa.inseridas} inserida(s), ${mapa.atualizadas} atualizada(s), ` +
        `${mapa.desativadas} desativada(s) — ${registros.length} linha(s) em ${caminho}\n` +
        `config: ${config.criadas} chave(s) criada(s); as demais já existiam e foram preservadas`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((erro: unknown) => {
  console.error(`seed falhou: ${erro instanceof Error ? erro.message : String(erro)}`);
  process.exitCode = 1;
});
