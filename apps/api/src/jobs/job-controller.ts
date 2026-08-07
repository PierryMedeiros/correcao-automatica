import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '../db/client.js';
import type { Logger } from '../log.js';
import type { DockerCli } from './docker.js';
import { ARQUIVO_TRANSCRIPT, criarJobDir, type ComposeConhecido, type JobJson } from './job-dir.js';
import { caminhoDoJobDir, labelDoJob, networkDoJob, nomeDoRunner } from './nomes.js';
import { timeoutEfetivoS } from './timeout.js';

// Job Controller: prepara os arquivos do job e sobe o runner (plan §8, §9.2 passo 3).
//
// Ele NÃO clona e NÃO invoca o agente — isso é do entrypoint (Apêndice B (06/08) item 5). A
// fronteira existe para o retry corretivo do §7 ter um container vivo para reentrar, e para o
// controller poder morrer e ser reconstruído sem levar o job junto.
//
// Ainda não mora num módulo do Nest: até a F4.0 isto é TypeScript puro, sem decorator nem DI
// (D2 da F2). As dependências entram por parâmetro, que é o que torna a ordem das chamadas
// testável sem Docker.

/** §8. Não são configuráveis por enquanto: o plano os fixa e não há chave em `config` para eles. */
const LIMITE_CPUS = '2';
const LIMITE_MEMORIA = '2.5g';

/** §8 — starts espaçados para 4 runners não sincronizarem a tempestade de `npm install`. */
const JITTER_MIN_MS = 5_000;
const JITTER_MAX_MS = 15_000;

const SOCKET_DOCKER = '/var/run/docker.sock';
const GUIA_DE_DEVOLUTIVAS = join('_shared', 'devolutivas-guide.md');

export class SkillIndisponivelError extends Error {
  constructor(caminho: string, motivo: string) {
    super(
      `${motivo}: ${caminho}. Montar caminho inexistente faria o Docker criar um diretório vazio, ` +
        'e a correção rodaria sem critérios ou sem o guia de devolutivas — falha silenciosa que só ' +
        'apareceria na revisão humana (plan §8).',
    );
    this.name = 'SkillIndisponivelError';
  }
}

export class TokenAusenteError extends Error {
  constructor() {
    super(
      'CLAUDE_CODE_OAUTH_TOKEN não está no ambiente. Rode `claude setup-token` e guarde o valor ' +
        'que começa com `sk-ant-oat01-` no .env da raiz (§17.3).',
    );
    this.name = 'TokenAusenteError';
  }
}

export interface AmbienteDoJob {
  skillsDir: string;
  jobsDir: string;
  runnerImage: string;
}

export interface DepsDoJobController {
  prisma: PrismaClient;
  docker: DockerCli;
  logger: Logger;
  ambiente: AmbienteDoJob;
  /** Injetáveis para o teste não gastar 15 segundos de jitter de verdade (§8). */
  esperar?: (ms: number) => Promise<void>;
  aleatorio?: () => number;
  tokenPresente?: () => boolean;
}

export interface PedidoDeJob {
  submissaoId: string;
  alunoNome: string;
  alunoEmail: string;
  projeto: string;
  fase: string;
  skillSlug: string;
  repoUrl: string;
  commitSha: string | null;
  modelo: string;
  retryN: number;
  /** Seam da carga (D4): vazio na F2, a F3 preenche com a invocação do `claude -p`. */
  payloadCmd?: string;
  cloneTimeoutS?: number;
  /** Compose do aluno já conhecido pelo host — hoje só o harness de job fake tem (ver `job-dir.ts`). */
  compose?: ComposeConhecido;
}

export interface JobEmVoo {
  correcaoId: string;
  submissaoId: string;
  jobDir: string;
  container: string;
  network: string;
  jobJson: JobJson;
}

/** O que existe depois da preparação e antes de qualquer container: linha em `correcoes`, job dir
 *  materializado e os caminhos já resolvidos. */
export interface JobPreparado extends JobEmVoo {
  montagens: { skill: string; shared: string };
  pedido: PedidoDeJob;
}

export interface JobController {
  /** Passo 3 do §9.2: prepara os arquivos. Nada de Docker acontece aqui. */
  prepararJob(pedido: PedidoDeJob): Promise<JobPreparado>;
  /** Network → create → connect → start, nesta ordem (D6). */
  subirRunner(preparado: JobPreparado): Promise<JobEmVoo>;
  /** Os dois acima, para quem não precisa escrever nada no job dir entre eles. */
  iniciarJob(pedido: PedidoDeJob): Promise<JobEmVoo>;
}

const esperarDeVerdade = (ms: number): Promise<void> =>
  new Promise((resolver) => setTimeout(resolver, ms));

export function criarJobController(deps: DepsDoJobController): JobController {
  const { prisma, docker, logger, ambiente } = deps;
  const esperar = deps.esperar ?? esperarDeVerdade;
  const aleatorio = deps.aleatorio ?? Math.random;
  const tokenPresente = deps.tokenPresente ?? (() => true);

  /**
   * Confere o que vai ser montado ANTES de criar recurso nenhum.
   *
   * Um `-v` para caminho que não existe não dá erro: o Docker cria o diretório vazio e monta. O
   * agente correria sem a skill (sem critérios) ou sem o guia de devolutivas, e a correção sairia
   * fora do padrão sem nada no caminho denunciando (§8, achado da quebra em fases).
   */
  function conferirMontagens(skillSlug: string): { skill: string; shared: string } {
    const skill = join(ambiente.skillsDir, skillSlug);
    const shared = join(ambiente.skillsDir, '_shared');
    const guia = join(ambiente.skillsDir, GUIA_DE_DEVOLUTIVAS);

    if (!existsSync(skill) || !statSync(skill).isDirectory()) {
      throw new SkillIndisponivelError(skill, 'skill não encontrada em $SKILLS_DIR');
    }
    if (!existsSync(guia)) {
      throw new SkillIndisponivelError(guia, 'guia de devolutivas não encontrado');
    }

    return { skill, shared };
  }

  /**
   * A linha de `correcoes` nasce em `rodando` **antes** do `docker run` (D1).
   *
   * É o que dá sentido ao resto: o §10.12 só reconhece uma correção órfã se ela já estiver
   * persistida quando o processo cai, e o §11 só distingue job dir órfão de referenciado se o nome
   * do diretório for `correcoes.id`. O id sai da sequência antes do insert porque o caminho do
   * `transcript_path` (NOT NULL) depende dele — a alternativa seria gravar um valor falso e
   * corrigir depois, deixando uma janela em que a linha mente.
   */
  async function criarCorrecaoRodando(pedido: PedidoDeJob): Promise<string> {
    const [{ id }] = await prisma.$queryRaw<[{ id: bigint }]>`
      SELECT nextval(pg_get_serial_sequence('correcoes', 'id')) AS id
    `;
    const correcaoId = id.toString();

    await prisma.correcao.create({
      data: {
        id,
        submissaoId: BigInt(pedido.submissaoId),
        retryN: pedido.retryN,
        status: 'rodando',
        modelo: pedido.modelo,
        transcriptPath: join(caminhoDoJobDir(ambiente.jobsDir, correcaoId), ARQUIVO_TRANSCRIPT),
      },
    });

    return correcaoId;
  }

  function argumentosDoCreate(
    correcaoId: string,
    jobDir: string,
    montagens: { skill: string; shared: string },
    pedido: PedidoDeJob,
  ): string[] {
    const args = [
      'create',
      '--name',
      nomeDoRunner(correcaoId),
      '--label',
      labelDoJob(correcaoId),
      '--cpus',
      LIMITE_CPUS,
      '--memory',
      LIMITE_MEMORIA,
      '-v',
      `${jobDir}:/workspace`,
      // O segundo mount do job dir NÃO é redundância (Apêndice B v1.6 item 1, spike S3): é o que
      // faz um caminho resolvido pelo compose significar a mesma coisa no runner e no daemon do
      // host. Sem ele, `./dados` do aluno vira um diretório vazio criado pelo daemon, a stack sobe
      // sem os arquivos dele e a correção avalia outro ambiente — sem erro nenhum no caminho.
      '-v',
      `${jobDir}:${jobDir}`,
      '-v',
      `${montagens.skill}:/workspace/skill:ro`,
      '-v',
      `${montagens.shared}:/workspace/_shared:ro`,
      '-v',
      `${SOCKET_DOCKER}:${SOCKET_DOCKER}`,
      // Sem `=valor`: o Docker copia do ambiente deste processo, então o segredo não aparece em
      // `ps` nem em log de comando (regra dura 5).
      '-e',
      'CLAUDE_CODE_OAUTH_TOKEN',
      '-e',
      `FC_JOB_ID=${correcaoId}`,
    ];

    if (pedido.payloadCmd) args.push('-e', `FC_PAYLOAD_CMD=${pedido.payloadCmd}`);
    if (pedido.cloneTimeoutS !== undefined) {
      args.push('-e', `FC_CLONE_TIMEOUT_S=${pedido.cloneTimeoutS}`);
    }

    args.push(ambiente.runnerImage);
    return args;
  }

  const controlador: JobController = {
    async prepararJob(pedido) {
      // Tudo o que pode abortar sem deixar rastro roda antes de qualquer criação.
      const montagens = conferirMontagens(pedido.skillSlug);
      if (!tokenPresente()) throw new TokenAusenteError();

      const timeoutS = await timeoutEfetivoS(prisma, pedido);
      const correcaoId = await criarCorrecaoRodando(pedido);
      const network = networkDoJob(correcaoId);

      const { caminho: jobDir, jobJson } = criarJobDir(
        ambiente.jobsDir,
        {
          correcaoId,
          submissaoId: pedido.submissaoId,
          alunoNome: pedido.alunoNome,
          alunoEmail: pedido.alunoEmail,
          projeto: pedido.projeto,
          fase: pedido.fase,
          skillSlug: pedido.skillSlug,
          repoUrl: pedido.repoUrl,
          commitSha: pedido.commitSha,
          modelo: pedido.modelo,
          timeoutS,
        },
        network,
        pedido.compose,
      );

      logger
        .child({ job_id: correcaoId, submissao_id: pedido.submissaoId })
        .info({ job_dir: jobDir, timeout_s: timeoutS }, 'job dir pronto');

      return {
        correcaoId,
        submissaoId: pedido.submissaoId,
        jobDir,
        container: nomeDoRunner(correcaoId),
        network,
        jobJson,
        montagens,
        pedido,
      };
    },

    async subirRunner(preparado) {
      const { correcaoId, container, network, jobDir } = preparado;
      const log = logger.child({ job_id: correcaoId, submissao_id: preparado.submissaoId });

      // A ORDEM ABAIXO É O CONTRATO (D6, Apêndice B (06/08) item 1). A network nasce primeiro e o
      // container é conectado a ela antes de existir processo lá dentro: `run -d` seguido de
      // connect deixaria uma janela em que o runner já roda fora da network do job, e a stack que
      // ele subisse nessa janela nasceria fora dela. `job-controller.test.ts` trava esta sequência.
      await docker(['network', 'create', network, '--label', labelDoJob(correcaoId)]);
      await docker(argumentosDoCreate(correcaoId, jobDir, preparado.montagens, preparado.pedido));
      await docker(['network', 'connect', network, container]);

      const jitterMs = Math.round(JITTER_MIN_MS + aleatorio() * (JITTER_MAX_MS - JITTER_MIN_MS));
      log.info({ jitter_ms: jitterMs }, 'aguardando o jitter de start (§8)');
      await esperar(jitterMs);

      await docker(['start', container]);
      log.info({ container, network }, 'runner de pé');

      // Daqui em diante todo caminho de saída precisa passar pelo teardown: o runner permanece
      // vivo de propósito (§8, v1.5) e não morre sozinho. Acompanhamento, coleta e teardown são
      // F2.5 e F2.6 — enquanto elas não existem, o que subir aqui sai pelo janitor ou à mão.
      return {
        correcaoId,
        submissaoId: preparado.submissaoId,
        jobDir,
        container,
        network,
        jobJson: preparado.jobJson,
      };
    },

    async iniciarJob(pedido) {
      return controlador.subirRunner(await controlador.prepararJob(pedido));
    },
  };

  return controlador;
}
