import { execFile } from 'node:child_process';
import { cpSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { criarPrisma } from '../../apps/api/src/db/client.js';
import {
  databaseUrl,
  jobsDir,
  runnerImage,
  skillsDir,
  tokenClaudePresente,
} from '../../apps/api/src/env.js';
import { criarDockerCli } from '../../apps/api/src/jobs/docker.js';
import { ARQUIVO_DOSSIE, ARQUIVO_RESULTADO } from '../../apps/api/src/jobs/job-dir.js';
import { criarJobController, type JobEmVoo } from '../../apps/api/src/jobs/job-controller.js';
import { labelDoJob } from '../../apps/api/src/jobs/nomes.js';
import { criarLogger } from '../../apps/api/src/log.js';
import { NOME_DO_BARE, criarRepoBare } from './repo-fixture.js';

// Harness de job fake (F2.0): roda N jobs fim a fim contra Docker de verdade, sem gastar agente.
//
// É ele que executa os aceites A1–A6 da F2 e vira a base do E2E da F7. Nasce como esqueleto e
// ganha capacidade a cada etapa do pipeline: hoje vai até a subida do runner (F2.4) e da carga,
// porque acompanhamento/timeout (F2.5) e teardown (F2.6) ainda não existem.

const executar = promisify(execFile);
const AQUI = fileURLToPath(new URL('.', import.meta.url));

const PROJETO_FAKE = 'Job Fake';
const FASE_FAKE = 'F2';

interface Opcoes {
  n: number;
  dormir: number;
  timeout: number | null;
  matarNoMeio: boolean;
}

function ajuda(): string {
  return `
pnpm job-fake — roda jobs fake fim a fim contra o Docker local (F2.0)

  --n <N>            quantos jobs em paralelo (default 1). O aceite A2 pede 4
  --dormir <s>       faz a carga dormir <s> antes de trabalhar, para provocar o timeout (A3)
  --timeout <s>      timeout do job em segundos       [PENDENTE: quem conta é a F2.5]
  --matar-no-meio    SIGKILL no próprio processo com jobs em voo (A4)
                                                      [a recuperação no boot é a F2.8]
  --help             esta ajuda

O que já funciona nesta metade da F2: semeia submissão + correção \`rodando\`, materializa o job
dir com job.json e o override noports, cria a network do job, sobe o runner na ordem
network → create → connect → start e espera a carga escrever o marcador.

O que ainda não: coleta e persistência do desfecho (F2.5), teardown em camadas (F2.6) e janitor
(F2.7). Por isso o relatório termina imprimindo o que ficou de pé e o comando exato para remover.
`.trimStart();
}

function lerOpcoes(argv: string[]): Opcoes | null {
  const { values } = parseArgs({
    args: argv,
    options: {
      n: { type: 'string' },
      dormir: { type: 'string' },
      timeout: { type: 'string' },
      'matar-no-meio': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });

  if (values.help) return null;

  return {
    n: Number(values.n ?? 1),
    dormir: Number(values.dormir ?? 0),
    timeout: values.timeout === undefined ? null : Number(values.timeout),
    matarNoMeio: values['matar-no-meio'] === true,
  };
}

/** Uma skill de verdade do `$SKILLS_DIR`: o controller aborta se o caminho não existir (§8), e é
 *  esse abort que o job fake precisa exercitar — montar um diretório inventado não provaria nada. */
function primeiraSkillReal(): string {
  const skills = readdirSync(skillsDir())
    .filter((nome) => nome.startsWith('corrige-'))
    .sort();

  const skill = skills[0];
  if (!skill) {
    throw new Error(
      `nenhuma skill \`corrige-*\` em ${skillsDir()}. Confira SKILLS_DIR no .env da raiz.`,
    );
  }
  return skill;
}

async function esperarMarcador(
  jobDir: string,
  limiteMs: number,
): Promise<Record<string, unknown> | null> {
  // PROVISÓRIO: quem detecta o fim pelo marcador, com timeout do §10.9 e coleta de artefatos, é a
  // F2.5. Esta espera existe só para o harness ter o que relatar enquanto ela não chega, e a
  // tarefa de trocá-la pela coleta de verdade está registrada na F2.5 do arquivo da fase.
  const alvo = join(jobDir, ARQUIVO_RESULTADO);
  const fim = Date.now() + limiteMs;

  while (Date.now() < fim) {
    if (existsSync(alvo)) {
      try {
        return JSON.parse(readFileSync(alvo, 'utf8')) as Record<string, unknown>;
      } catch {
        // Escrita parcial: só vale JSON completo.
      }
    }
    await new Promise((resolver) => setTimeout(resolver, 250));
  }

  return null;
}

async function contarRecursos(
  correcaoId: string,
): Promise<{ containers: number; networks: number }> {
  const label = labelDoJob(correcaoId);
  const containers = await executar('docker', ['ps', '-aq', '--filter', `label=${label}`]);
  const networks = await executar('docker', ['network', 'ls', '-q', '--filter', `label=${label}`]);

  return {
    containers: containers.stdout.trim() ? containers.stdout.trim().split('\n').length : 0,
    networks: networks.stdout.trim() ? networks.stdout.trim().split('\n').length : 0,
  };
}

async function principal(): Promise<void> {
  const opcoes = lerOpcoes(process.argv.slice(2));
  if (!opcoes) {
    process.stdout.write(ajuda());
    return;
  }

  if (!tokenClaudePresente()) {
    throw new Error('CLAUDE_CODE_OAUTH_TOKEN ausente no .env — o runner não sobe sem ele (§17.3).');
  }

  const prisma = criarPrisma(databaseUrl());
  const logger = criarLogger();
  const controller = criarJobController({
    prisma,
    docker: criarDockerCli(logger),
    logger,
    ambiente: { skillsDir: skillsDir(), jobsDir: jobsDir(), runnerImage: runnerImage() },
  });

  const skillSlug = primeiraSkillReal();
  const compose = readFileSync(join(AQUI, 'fixtures', 'compose-portas-fixas.yaml'), 'utf8');

  // O bare repo nasce uma vez e é copiado para cada job dir: o SHA precisa ser conhecido ANTES do
  // `job.json`, que é escrito na preparação do job.
  const fixtures = mkdtempSync(join(tmpdir(), 'banca-job-fake-'));
  const { commitSha } = criarRepoBare(fixtures);

  console.log(`job-fake: ${opcoes.n} job(s), skill ${skillSlug}, commit ${commitSha.slice(0, 8)}`);
  if (opcoes.timeout !== null) {
    console.log('job-fake: --timeout ainda não é aplicado — quem conta o tempo é a F2.5.');
  }

  const emVoo: JobEmVoo[] = [];

  try {
    const jobs = await Promise.all(
      Array.from({ length: opcoes.n }, async (_, indice) => {
        const submissao = await prisma.submissao.create({
          data: {
            origem: 'manual',
            alunoNome: `Aluno Fake ${indice + 1}`,
            alunoEmail: `aluno-fake-${indice + 1}-${Date.now()}@exemplo.invalido`,
            projeto: PROJETO_FAKE,
            fase: FASE_FAKE,
            skillSlug,
            repoUrl: 'file:///workspace/repo-exemplo.git',
            commitSha,
            status: 'corrigindo',
          },
        });

        const preparado = await controller.prepararJob({
          submissaoId: submissao.id.toString(),
          alunoNome: submissao.alunoNome,
          alunoEmail: submissao.alunoEmail,
          projeto: PROJETO_FAKE,
          fase: FASE_FAKE,
          skillSlug,
          repoUrl: submissao.repoUrl,
          commitSha,
          modelo: 'fake',
          retryN: 1,
          payloadCmd: `FC_FAKE_DORMIR_S=${opcoes.dormir} bash /workspace/payload.sh`,
          compose: { conteudo: compose },
        });

        // Só o job dir é visível dentro do runner: a carga e o repo do "aluno" entram por aqui.
        copyFileSync(join(AQUI, 'payload.sh'), join(preparado.jobDir, 'payload.sh'));
        cpSync(join(fixtures, NOME_DO_BARE), join(preparado.jobDir, NOME_DO_BARE), {
          recursive: true,
        });

        const job = await controller.subirRunner(preparado);
        emVoo.push(job);
        return job;
      }),
    );

    if (opcoes.matarNoMeio) {
      console.log('job-fake: SIGKILL no próprio processo, com os jobs em voo (aceite A4).');
      console.log('job-fake: a recuperação de órfãos no boot é a F2.8 — hoje as correções ficam');
      console.log(
        '          em `rodando` e os runners de pé, que é exatamente o que ela conserta.',
      );
      process.kill(process.pid, 'SIGKILL');
    }

    const limiteMs = (opcoes.dormir + 180) * 1000;
    const relatorio = await Promise.all(
      jobs.map(async (job) => {
        const marcador = await esperarMarcador(job.jobDir, limiteMs);
        const recursos = await contarRecursos(job.correcaoId);
        return {
          correcao: job.correcaoId,
          exit_code: marcador?.['exit_code'] ?? '(sem marcador)',
          motivo: marcador?.['motivo'] ?? '-',
          dossie: existsSync(join(job.jobDir, ARQUIVO_DOSSIE)) ? 'sim' : 'não',
          containers: recursos.containers,
          networks: recursos.networks,
        };
      }),
    );

    console.log('\njob-fake: relatório');
    console.table(relatorio);
  } finally {
    rmSync(fixtures, { recursive: true, force: true });
    await prisma.$disconnect();
  }

  if (emVoo.length > 0) {
    console.log(
      '\njob-fake: teardown é a F2.6 e ainda não existe. Para remover o que subiu agora (por\n' +
        '          label e por nome, nunca prune — regra dura 1):\n',
    );
    console.log(`  docker rm -f ${emVoo.map((j) => j.container).join(' ')}`);
    console.log(`  docker network rm ${emVoo.map((j) => j.network).join(' ')}`);
    console.log('\n  Os job dirs ficam no disco de propósito (§11): são a auditoria da correção.');
  }
}

await principal();
