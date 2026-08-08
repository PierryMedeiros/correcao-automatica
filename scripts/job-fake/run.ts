import { execFile } from 'node:child_process';
import { cpSync, copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { criarPrisma } from '../../apps/api/src/db/client.js';
import {
  databaseUrl,
  jobsDir,
  runnerImage,
  skillsDir,
  tokenClaudePresente,
} from '../../apps/api/src/env.js';
import { criarDockerCli } from '../../apps/api/src/jobs/docker.js';
import { ARQUIVO_DOSSIE } from '../../apps/api/src/jobs/job-dir.js';
import {
  criarJobController,
  type DesfechoDoJob,
  type JobPreparado,
} from '../../apps/api/src/jobs/job-controller.js';
import { labelDoJob } from '../../apps/api/src/jobs/nomes.js';
import { criarRecuperacao } from '../../apps/api/src/jobs/recuperacao.js';
import { criarTeardown } from '../../apps/api/src/jobs/teardown.js';
import { criarLogger } from '../../apps/api/src/log.js';
import { NOME_DO_BARE, criarRepoBare } from './repo-fixture.js';

// Harness de job fake (F2.0): roda N jobs fim a fim contra Docker de verdade, sem gastar agente.
//
// É ele que executa os aceites A1–A6 da F2 e vira a base do E2E da F7. Cobre o pipeline inteiro —
// prepara o job dir, sobe o runner, acompanha até o marcador (ou o timeout), colhe os artefatos,
// persiste a correção e derruba tudo o que criou.
//
// Até a F5 este processo é o "processo que acompanha os jobs" do §10.12: por isso ele começa
// rodando a recuperação de órfãos, exatamente como a API vai fazer no boot (F4).

const executar = promisify(execFile);
const AQUI = fileURLToPath(new URL('.', import.meta.url));

const PROJETO_FAKE = 'Job Fake';
const FASE_FAKE = 'F2';

interface Opcoes {
  n: number;
  dormir: number;
  timeout: number | null;
  matarNoMeio: boolean;
  recuperar: boolean;
}

function ajuda(): string {
  return `
pnpm job-fake — roda jobs fake fim a fim contra o Docker local (F2.0)

  --n <N>            quantos jobs em paralelo (default 1). O aceite A2 pede 4
  --dormir <s>       faz a carga dormir <s> antes de trabalhar, para provocar o timeout (A3)
  --timeout <s>      timeout do job em segundos. Vira \`skills_map.timeout_s\` do desafio fake
                     ("${PROJETO_FAKE}" / "${FASE_FAKE}"), que é o caminho real do §10.9 — sem a
                     flag, o override é limpo e vale o \`config.timeout_job_padrao_s\`
  --matar-no-meio    SIGKILL no próprio processo com jobs em voo (A4). A recuperação acontece na
                     execução seguinte, que é o boot do processo dono dos jobs (§10.12)
  --recuperar        só roda a recuperação de órfãos e sai — o segundo passo do A4
  --help             esta ajuda

Todo início de execução roda a recuperação de órfãos (F2.8) antes de qualquer job novo: até a F5,
este processo é o que o §10.12 chama de "processo que acompanha os jobs".

O job dir de cada correção fica no disco de propósito (§11): é a auditoria dela. Quem aplica a
retenção é o \`pnpm janitor\`.
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
      recuperar: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });

  if (values.help) return null;

  return {
    n: Number(values.n ?? 1),
    dormir: Number(values.dormir ?? 0),
    timeout: values.timeout === undefined ? null : Number(values.timeout),
    matarNoMeio: values['matar-no-meio'] === true,
    recuperar: values.recuperar === true,
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
  const docker = criarDockerCli(logger);
  const teardown = criarTeardown({ docker, logger, jobsDir: jobsDir() });
  const controller = criarJobController({
    prisma,
    docker,
    logger,
    teardown,
    ambiente: { skillsDir: skillsDir(), jobsDir: jobsDir(), runnerImage: runnerImage() },
  });

  try {
    // Boot: o §10.12 acontece aqui, antes de qualquer job novo (F2.8).
    const recuperadas = await criarRecuperacao({
      prisma,
      teardown,
      logger,
    }).recuperarCorrecoesOrfas();
    if (recuperadas.length > 0) {
      console.log(`job-fake: ${recuperadas.length} correção(ões) órfã(s) recuperada(s) no boot:`);
      console.table(
        recuperadas.map((r) => ({
          correcao: r.correcaoId,
          submissao: r.submissaoId,
          containers: r.teardown.containersRemovidos.length,
          networks: r.teardown.networksRemovidas.length,
        })),
      );
      console.log(
        '          As submissões seguem em `corrigindo`: devolvê-las à fila consumindo retry é da F4.',
      );
    }
    if (opcoes.recuperar) return;

    const skillSlug = primeiraSkillReal();
    const compose = readFileSync(join(AQUI, 'fixtures', 'compose-portas-fixas.yaml'), 'utf8');
    await aplicarTimeoutDoDesafio(prisma, skillSlug, opcoes.timeout);

    // O bare repo nasce uma vez e é copiado para cada job dir: o SHA precisa ser conhecido ANTES do
    // `job.json`, que é escrito na preparação do job.
    const fixtures = mkdtempSync(join(tmpdir(), 'banca-job-fake-'));
    const { commitSha } = criarRepoBare(fixtures);

    console.log(
      `job-fake: ${opcoes.n} job(s), skill ${skillSlug}, commit ${commitSha.slice(0, 8)}` +
        `${opcoes.timeout === null ? '' : `, timeout ${opcoes.timeout}s`}`,
    );

    let preparados: JobPreparado[];
    try {
      preparados = await Promise.all(
        Array.from({ length: opcoes.n }, (_, indice) =>
          prepararUm(prisma, controller, {
            indice,
            skillSlug,
            commitSha,
            compose,
            fixtures,
            opcoes,
          }),
        ),
      );
    } finally {
      rmSync(fixtures, { recursive: true, force: true });
    }

    if (opcoes.matarNoMeio) {
      // Sobe os runners e mata este processo com eles em voo: é o §10.12 provocado de verdade.
      // O teardown do `executarJob` não roda — que é exatamente o ponto.
      await Promise.all(preparados.map((preparado) => controller.subirRunner(preparado)));
      console.log('job-fake: SIGKILL no próprio processo, com os jobs em voo (aceite A4).');
      console.log(
        'job-fake: rode `pnpm job-fake --recuperar` para o boot seguinte fazer o §10.12.',
      );
      process.kill(process.pid, 'SIGKILL');
    }

    const desfechos = await Promise.allSettled(
      preparados.map((preparado) => controller.executarJob(preparado)),
    );

    console.log('\njob-fake: relatório');
    console.table(
      await Promise.all(
        desfechos.map(async (resultado, indice) => {
          const preparado = preparados[indice];
          const correcaoId = preparado?.correcaoId ?? '?';
          const recursos = await contarRecursos(correcaoId);
          const desfecho: DesfechoDoJob | null =
            resultado.status === 'fulfilled' ? resultado.value : null;

          return {
            correcao: correcaoId,
            status: desfecho?.status ?? 'exceção',
            exit_code: desfecho?.exitCode ?? '-',
            duracao_s: desfecho?.duracaoS ?? '-',
            dossie: existsSync(join(preparado?.jobDir ?? '', ARQUIVO_DOSSIE)) ? 'sim' : 'não',
            containers: recursos.containers,
            networks: recursos.networks,
          };
        }),
      ),
    );

    for (const [indice, resultado] of desfechos.entries()) {
      if (resultado.status === 'rejected') {
        console.log(`job-fake: job ${indice + 1} explodiu — ${String(resultado.reason)}`);
      } else if (resultado.value.erroResumo) {
        console.log(`job-fake: job ${resultado.value.correcaoId} — ${resultado.value.erroResumo}`);
      }
    }

    console.log(
      '\njob-fake: as colunas `containers` e `networks` são o aceite A1/A6 — qualquer valor ' +
        'diferente de 0\n          é recurso que escapou do teardown. Os job dirs ficam em ' +
        `${jobsDir()} de propósito (§11).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * `--timeout` entra pelo caminho de verdade do §10.9: override do desafio em `skills_map`.
 *
 * Passar o número direto ao controller seria mais curto e cravaria um literal de segundos fora do
 * banco, que é justamente o que o §10.9 proíbe. Sem a flag, o override é limpo — senão um
 * `--timeout 10` de ontem mataria em 10s o job de hoje.
 */
async function aplicarTimeoutDoDesafio(
  prisma: ReturnType<typeof criarPrisma>,
  skillSlug: string,
  timeoutS: number | null,
): Promise<void> {
  await prisma.skillsMap.upsert({
    where: { projeto_fase: { projeto: PROJETO_FAKE, fase: FASE_FAKE } },
    update: { skillSlug, modoAvaliacao: 'execucao', timeoutS, ativo: true },
    create: {
      projeto: PROJETO_FAKE,
      fase: FASE_FAKE,
      skillSlug,
      modoAvaliacao: 'execucao',
      timeoutS,
    },
  });
}

async function prepararUm(
  prisma: ReturnType<typeof criarPrisma>,
  controller: ReturnType<typeof criarJobController>,
  contexto: {
    indice: number;
    skillSlug: string;
    commitSha: string;
    compose: string;
    fixtures: string;
    opcoes: Opcoes;
  },
): Promise<JobPreparado> {
  const { indice, skillSlug, commitSha, compose, fixtures, opcoes } = contexto;

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
  cpSync(join(fixtures, NOME_DO_BARE), join(preparado.jobDir, NOME_DO_BARE), { recursive: true });

  return preparado;
}

await principal();
