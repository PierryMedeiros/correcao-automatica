import type { PrismaClient } from '../db/client.js';

// Timeout efetivo do job (§5, §10.9): override do desafio quando existe, default global quando não.
//
// Os dois valores moram no banco (F1) e nenhum literal de segundos aparece em código de job: o
// número que decide matar uma correção precisa ser calibrável sem recompilar, e precisa ser o
// mesmo para quem conta o tempo (F2.5) e para quem o declara no `job.json` (F2.3).

export const CHAVE_TIMEOUT_PADRAO = 'timeout_job_padrao_s';

export async function timeoutEfetivoS(
  prisma: PrismaClient,
  desafio: { projeto: string; fase: string },
): Promise<number> {
  const doDesafio = await prisma.skillsMap.findUnique({
    where: { projeto_fase: { projeto: desafio.projeto, fase: desafio.fase } },
    select: { timeoutS: true },
  });

  if (doDesafio?.timeoutS != null) return doDesafio.timeoutS;

  const padrao = await prisma.config.findUnique({ where: { chave: CHAVE_TIMEOUT_PADRAO } });

  if (typeof padrao?.valor !== 'number') {
    throw new Error(
      `config.${CHAVE_TIMEOUT_PADRAO} ausente ou não numérica. Rode \`pnpm db:seed\` para carregar ` +
        'os defaults do §10/§12.',
    );
  }

  return padrao.valor;
}
