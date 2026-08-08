import { criarPrisma } from '../apps/api/src/db/client.js';
import { databaseUrl, jobsDir } from '../apps/api/src/env.js';
import { criarDockerCli } from '../apps/api/src/jobs/docker.js';
import { criarJanitor } from '../apps/api/src/janitor/janitor.js';
import { criarLogger } from '../apps/api/src/log.js';

// Entrada CLI do janitor (F2.7, D3). O §12 quer o janitor como cron do pg-boss, e o pg-boss só
// entra na F4 — que vai registrar o schedule chamando **esta mesma função**, não uma cópia.
//
// O relatório imprime o que foi removido **e o que foi preservado**: um janitor que só conta
// remoção não deixa como auditar a decisão de não apagar, que é a decisão mais cara dele (§11).

const prisma = criarPrisma(databaseUrl());
const logger = criarLogger();

try {
  const relatorio = await criarJanitor({
    prisma,
    docker: criarDockerCli(logger),
    logger,
    jobsDir: jobsDir(),
  }).executarCiclo();

  console.log('\njanitor: removido');
  console.table([
    { tipo: 'containers', quantidade: relatorio.containersRemovidos.length },
    { tipo: 'networks', quantidade: relatorio.networksRemovidas.length },
    { tipo: 'volumes', quantidade: relatorio.volumesRemovidos.length },
    { tipo: 'imagens do job', quantidade: relatorio.imagensRemovidas.length },
    { tipo: 'job dirs', quantidade: relatorio.jobDirsRemovidos.length },
  ]);

  for (const recurso of [
    ...relatorio.containersRemovidos,
    ...relatorio.networksRemovidas,
    ...relatorio.volumesRemovidos,
  ]) {
    console.log(`  - ${recurso.nome} (job ${recurso.correcaoId})`);
  }
  for (const dir of relatorio.jobDirsRemovidos) console.log(`  - ${dir.caminho}: ${dir.motivo}`);

  if (relatorio.jobDirsPreservados.length > 0) {
    console.log('\njanitor: job dirs preservados (§11)');
    for (const dir of relatorio.jobDirsPreservados)
      console.log(`  - ${dir.caminho}: ${dir.motivo}`);
  }

  if (relatorio.disco) {
    const { livreGb, alertaGb, pausaGb, alerta, pausaEscrita } = relatorio.disco;
    console.log(
      `\njanitor: disco com ${livreGb} GB livres (alerta < ${alertaGb}, pausa < ${pausaGb})` +
        `${alerta ? ' — ABAIXO DO ALERTA' : ''}${pausaEscrita ? ' — PAUSA GLOBAL GRAVADA' : ''}`,
    );
  }

  if (relatorio.erros.length > 0) {
    console.log('\njanitor: erros do ciclo');
    for (const erro of relatorio.erros) console.log(`  ! ${erro}`);
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
