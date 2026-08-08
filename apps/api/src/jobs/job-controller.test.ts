import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prismaTeste } from '../../tests/setup-db.js';
import { criarLogger } from '../log.js';
import type { ResultadoDocker } from './docker.js';
import type { JobJson } from './job-dir.js';
import {
  SkillIndisponivelError,
  TokenAusenteError,
  criarJobController,
  type DepsDoJobController,
  type PedidoDeJob,
} from './job-controller.js';

// O que este arquivo trava é a ordem em que os recursos nascem e o que vai montado no runner.
// Nenhuma das duas coisas falha de forma barulhenta quando quebra: com a ordem errada, o runner
// roda alguns instantes fora da network do job e a stack que ele subir nasce fora dela; sem o
// mount-espelho do job dir, o `./algo` do compose do aluno vira um diretório vazio criado pelo
// daemon e a correção avalia um ambiente que não é o do aluno (spike S3).

// Deliberadamente SEM o prefixo real de um token do `setup-token`: o que o teste afirma é que este
// valor não aparece em log nem em argv, e o formato dele não muda isso. Um literal com cara de
// credencial de verdade seria barrado pelo guard de segredo — corretamente.
const TOKEN_FALSO = 'valor-de-token-que-nao-pode-vazar-em-lugar-nenhum';

let jobsDir: string;
let skillsDir: string;
let chamadas: string[];
let linhasDeLog: string[];
let tokenOriginal: string | undefined;

function registrarDocker(): (args: string[]) => Promise<ResultadoDocker> {
  return async (args) => {
    chamadas.push(args.join(' '));
    return { stdout: '', stderr: '' };
  };
}

function controlador(
  opcoes: {
    tokenPresente?: () => boolean;
    aguardarMarcador?: DepsDoJobController['aguardarMarcador'];
    aoColetar?: DepsDoJobController['aoColetar'];
  } = {},
) {
  const destino = new Writable({
    write(pedaco, _codificacao, pronto) {
      linhasDeLog.push(String(pedaco));
      pronto();
    },
  });

  return criarJobController({
    prisma: prismaTeste(),
    docker: registrarDocker(),
    logger: criarLogger(destino),
    ambiente: { jobsDir, skillsDir, runnerImage: 'banca-runner:teste' },
    esperar: async (ms) => {
      chamadas.push(`jitter ${ms}`);
    },
    aleatorio: () => 0.5,
    tokenPresente: opcoes.tokenPresente ?? (() => true),
    ...(opcoes.aguardarMarcador ? { aguardarMarcador: opcoes.aguardarMarcador } : {}),
    ...(opcoes.aoColetar ? { aoColetar: opcoes.aoColetar } : {}),
  });
}

/** O marcador que o entrypoint teria escrito, sem esperar por runner nenhum. */
function marcadorDe(exitCode: number, motivo = 'carga_concluida') {
  return async () => ({
    exit_code: exitCode,
    finished_at: '2026-08-07T12:00:00Z',
    motivo,
  });
}

async function semearSubmissao(): Promise<string> {
  const submissao = await prismaTeste().submissao.create({
    data: {
      origem: 'manual',
      alunoNome: 'Aluno de Teste',
      alunoEmail: 'aluno@exemplo.invalido',
      projeto: 'GoLang',
      fase: 'Client-Server-API',
      skillSlug: 'corrige-client-server-api',
      repoUrl: 'https://github.com/exemplo/entrega.git',
      commitSha: 'a'.repeat(40),
      status: 'corrigindo',
    },
  });
  return submissao.id.toString();
}

async function semearTimeoutPadrao(valor = 1500): Promise<void> {
  await prismaTeste().config.create({
    data: { chave: 'timeout_job_padrao_s', valor, descricao: 'fixture do teste' },
  });
}

function pedido(submissaoId: string, extras: Partial<PedidoDeJob> = {}): PedidoDeJob {
  return {
    submissaoId,
    alunoNome: 'Aluno de Teste',
    alunoEmail: 'aluno@exemplo.invalido',
    projeto: 'GoLang',
    fase: 'Client-Server-API',
    skillSlug: 'corrige-client-server-api',
    repoUrl: 'https://github.com/exemplo/entrega.git',
    commitSha: 'a'.repeat(40),
    modelo: 'fake',
    retryN: 1,
    ...extras,
  };
}

function argumentosDoCreate(): string[] {
  const linha = chamadas.find((c) => c.startsWith('create '));
  if (!linha)
    throw new Error(`nenhum "docker create" foi chamado. Chamadas: ${chamadas.join(' | ')}`);
  return linha.split(' ');
}

beforeEach(() => {
  jobsDir = mkdtempSync(join(tmpdir(), 'banca-jobs-'));
  skillsDir = mkdtempSync(join(tmpdir(), 'banca-skills-'));
  mkdirSync(join(skillsDir, 'corrige-client-server-api'));
  mkdirSync(join(skillsDir, '_shared'));
  writeFileSync(join(skillsDir, '_shared', 'devolutivas-guide.md'), '# guia', 'utf8');
  chamadas = [];
  linhasDeLog = [];
  tokenOriginal = process.env['CLAUDE_CODE_OAUTH_TOKEN'];
  process.env['CLAUDE_CODE_OAUTH_TOKEN'] = TOKEN_FALSO;
});

afterEach(() => {
  rmSync(jobsDir, { recursive: true, force: true });
  rmSync(skillsDir, { recursive: true, force: true });
  if (tokenOriginal === undefined) delete process.env['CLAUDE_CODE_OAUTH_TOKEN'];
  else process.env['CLAUDE_CODE_OAUTH_TOKEN'] = tokenOriginal;
});

describe('Job Controller — subida do runner', () => {
  it('cria a network antes do container e conecta antes do start (D6)', async () => {
    await semearTimeoutPadrao();
    const submissaoId = await semearSubmissao();

    const job = await controlador().iniciarJob(pedido(submissaoId));

    expect(chamadas.map((c) => c.split(' ').slice(0, 2).join(' '))).toEqual([
      'network create',
      'create --name',
      'network connect',
      `jitter ${10000}`,
      'start fc-job-' + job.correcaoId,
    ]);
  });

  it('monta o job dir DUAS vezes: em /workspace e no próprio caminho absoluto', async () => {
    await semearTimeoutPadrao();
    const job = await controlador().iniciarJob(pedido(await semearSubmissao()));
    const args = argumentosDoCreate();

    expect(args).toContain(`${job.jobDir}:/workspace`);
    // Remover este mount por "limpeza" reintroduz a falha silenciosa do §10.16 (Apêndice B v1.6).
    expect(args).toContain(`${job.jobDir}:${job.jobDir}`);
  });

  it('monta a skill e o _shared somente leitura, e o socket do Docker', async () => {
    await semearTimeoutPadrao();
    await controlador().iniciarJob(pedido(await semearSubmissao()));
    const args = argumentosDoCreate();

    expect(args).toContain(`${join(skillsDir, 'corrige-client-server-api')}:/workspace/skill:ro`);
    expect(args).toContain(`${join(skillsDir, '_shared')}:/workspace/_shared:ro`);
    expect(args).toContain('/var/run/docker.sock:/var/run/docker.sock');
  });

  it('aplica label, limites e nome do §8 em tudo o que cria (regra dura 2)', async () => {
    await semearTimeoutPadrao();
    const job = await controlador().iniciarJob(pedido(await semearSubmissao()));
    const args = argumentosDoCreate();

    expect(args).toContain(`fc.job=${job.correcaoId}`);
    expect(args).toContain('--cpus');
    expect(args).toContain('2');
    expect(args).toContain('--memory');
    expect(args).toContain('2.5g');
    expect(chamadas[0]).toBe(
      `network create fc-job-${job.correcaoId}_net --label fc.job=${job.correcaoId}`,
    );
  });

  it('espera o jitter do §8 entre 5s e 15s, antes do start', async () => {
    await semearTimeoutPadrao();
    await controlador().iniciarJob(pedido(await semearSubmissao()));

    const jitter = chamadas.find((c) => c.startsWith('jitter '));
    const ms = Number(jitter?.split(' ')[1]);
    expect(ms).toBeGreaterThanOrEqual(5_000);
    expect(ms).toBeLessThanOrEqual(15_000);
    expect(chamadas.indexOf(jitter!)).toBeLessThan(
      chamadas.findIndex((c) => c.startsWith('start')),
    );
  });

  it('aborta antes de criar qualquer recurso quando a skill não existe em $SKILLS_DIR', async () => {
    await semearTimeoutPadrao();
    const submissaoId = await semearSubmissao();

    await expect(
      controlador().iniciarJob(pedido(submissaoId, { skillSlug: 'corrige-que-nao-existe' })),
    ).rejects.toThrow(SkillIndisponivelError);

    expect(chamadas).toEqual([]);
    expect(await prismaTeste().correcao.count()).toBe(0);
  });

  it('aborta quando o guia de devolutivas do _shared não existe', async () => {
    await semearTimeoutPadrao();
    rmSync(join(skillsDir, '_shared', 'devolutivas-guide.md'));

    await expect(controlador().iniciarJob(pedido(await semearSubmissao()))).rejects.toThrow(
      SkillIndisponivelError,
    );
    expect(chamadas).toEqual([]);
  });

  it('aborta quando o token do Claude não está no ambiente', async () => {
    await semearTimeoutPadrao();

    await expect(
      controlador({ tokenPresente: () => false }).iniciarJob(pedido(await semearSubmissao())),
    ).rejects.toThrow(TokenAusenteError);
    expect(chamadas).toEqual([]);
  });

  it('nunca escreve o valor do token em log nem na linha de comando (regra dura 5)', async () => {
    await semearTimeoutPadrao();
    await controlador().iniciarJob(pedido(await semearSubmissao()));

    expect(linhasDeLog.join('\n')).not.toContain(TOKEN_FALSO);
    expect(chamadas.join('\n')).not.toContain(TOKEN_FALSO);
    // O Docker copia o valor do ambiente deste processo: `-e NOME`, sem `=valor`.
    expect(argumentosDoCreate()).toContain('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('persiste a correção em `rodando` antes de subir o runner, e o job dir leva o id dela (D1)', async () => {
    await semearTimeoutPadrao();
    const submissaoId = await semearSubmissao();

    const job = await controlador().iniciarJob(pedido(submissaoId));
    const correcao = await prismaTeste().correcao.findFirstOrThrow();

    expect(correcao.id.toString()).toBe(job.correcaoId);
    expect(correcao.status).toBe('rodando');
    expect(correcao.transcriptPath).toBe(join(jobsDir, job.correcaoId, 'transcript.jsonl'));
    expect(job.jobDir).toBe(join(jobsDir, job.correcaoId));
  });

  it('grava no job.json o timeout efetivo do §10.9, com o override da skill vencendo o default', async () => {
    await semearTimeoutPadrao(1500);
    await prismaTeste().skillsMap.create({
      data: {
        projeto: 'GoLang',
        fase: 'Client-Server-API',
        skillSlug: 'corrige-client-server-api',
        modoAvaliacao: 'execucao',
        timeoutS: 600,
      },
    });

    const job = await controlador().iniciarJob(pedido(await semearSubmissao()));
    const escrito = JSON.parse(readFileSync(join(job.jobDir, 'job.json'), 'utf8')) as JobJson;

    expect(escrito.timeout_s).toBe(600);
    expect(escrito.compose_project).toBe(`fc-job-${job.correcaoId}`);
  });

  it('cai no default de config quando o desafio não tem override de timeout', async () => {
    await semearTimeoutPadrao(1500);
    const job = await controlador().iniciarJob(pedido(await semearSubmissao()));

    expect(job.jobJson.timeout_s).toBe(1500);
  });

  it('escreve o override do compose e o comando canônico com caminho absoluto quando o compose é conhecido', async () => {
    await semearTimeoutPadrao();
    const job = await controlador().iniciarJob(
      pedido(await semearSubmissao(), {
        compose: { conteudo: 'services:\n  app:\n    image: nginx\n    ports: ["8080:8080"]\n' },
      }),
    );

    const override = readFileSync(join(job.jobDir, 'compose.override.yaml'), 'utf8');
    expect(override).toContain('ports: !reset []');
    expect(job.jobJson.compose?.comando_canonico).toBe(
      `docker compose -p fc-job-${job.correcaoId} ` +
        `-f ${join(job.jobDir, 'compose-aluno.yaml')} ` +
        `-f ${join(job.jobDir, 'compose.override.yaml')}`,
    );
    // `/workspace` aqui faria o daemon do host resolver o caminho no lugar errado (spike S3).
    expect(job.jobJson.compose?.comando_canonico).not.toContain('/workspace');
  });
});

// A partir daqui é a F2.5: o outro lado do job, onde ele fecha. O que estes testes travam é que o
// fim vem do marcador (nunca da saída do container, que não morre — §8 D10), que o timeout do
// §10.9 é contado pelo host e mata o runner, e que o teardown roda mesmo quando dá errado.
describe('Job Controller — acompanhamento e fechamento da correção', () => {
  it('fecha como `concluida` quando o marcador traz exit code 0', async () => {
    await semearTimeoutPadrao();
    const job = await controlador().iniciarJob(pedido(await semearSubmissao()));

    const desfecho = await controlador({ aguardarMarcador: marcadorDe(0) }).acompanharJob(job);

    expect(desfecho.status).toBe('concluida');
    expect(desfecho.erroResumo).toBeNull();

    const correcao = await prismaTeste().correcao.findFirstOrThrow();
    expect(correcao.status).toBe('concluida');
    expect(correcao.exitCode).toBe(0);
    expect(correcao.finishedAt).not.toBeNull();
    expect(correcao.duracaoS).not.toBeNull();
    // O dossiê só é validado e persistido na F3 (D5) — aqui ele é artefato coletado, não coluna.
    expect(correcao.dossie).toBeNull();
  });

  it('código do runner vira `falhou` com erro_resumo legível, sem parsear log', async () => {
    await semearTimeoutPadrao();
    const job = await controlador().iniciarJob(pedido(await semearSubmissao()));

    const desfecho = await controlador({
      aguardarMarcador: marcadorDe(65, 'clone_falhou'),
    }).acompanharJob(job);

    expect(desfecho.status).toBe('falhou');
    expect(desfecho.erroResumo).toContain('clone do repositório falhou');
  });

  it('sem marcador até o limite: mata o runner, marca `timeout` e preserva o job dir (§10.9)', async () => {
    await semearTimeoutPadrao(10);
    const job = await controlador().iniciarJob(pedido(await semearSubmissao()));
    chamadas = [];

    const desfecho = await controlador({ aguardarMarcador: async () => null }).acompanharJob(job);

    expect(desfecho.status).toBe('timeout');
    expect(desfecho.erroResumo).toContain('10s');
    expect(chamadas).toContain(`kill fc-job-${job.correcaoId}`);
    expect(existsSync(job.jobDir)).toBe(true);

    const correcao = await prismaTeste().correcao.findFirstOrThrow();
    expect(correcao.status).toBe('timeout');
    expect(correcao.exitCode).toBeNull();
  });

  it('coleta o dossiê como artefato, distinguindo os três estados (D5)', async () => {
    await semearTimeoutPadrao();
    const job = await controlador().iniciarJob(pedido(await semearSubmissao()));
    writeFileSync(join(job.jobDir, 'dossie.json'), '{"veredito": "aprovado"}', 'utf8');

    const desfecho = await controlador({ aguardarMarcador: marcadorDe(0) }).acompanharJob(job);

    expect(desfecho.artefatos.dossie.estado).toBe('valido');
    expect(desfecho.artefatos.transcriptPath).toBe(join(job.jobDir, 'transcript.jsonl'));
  });

  it('o ponto de extensão da F3 roda depois da coleta e antes de qualquer remoção (§7)', async () => {
    await semearTimeoutPadrao();
    const preparado = await controlador().prepararJob(pedido(await semearSubmissao()));

    let viuDossie: string | undefined;
    let removeuAntes = true;

    await controlador({
      aguardarMarcador: marcadorDe(0),
      aoColetar: async ({ artefatos }) => {
        viuDossie = artefatos.dossie.estado;
        // O runner precisa estar de pé aqui: é a única janela do `docker exec` + `--resume`.
        removeuAntes = chamadas.some((c) => c.startsWith('rm -f') || c.startsWith('stop '));
        return undefined;
      },
    }).executarJob(preparado);

    expect(viuDossie).toBe('ausente');
    expect(removeuAntes).toBe(false);
    expect(chamadas).toContain(`network rm fc-job-${preparado.correcaoId}_net`);
  });

  it('executarJob derruba o job mesmo quando o acompanhamento explode, sem deixar `rodando`', async () => {
    await semearTimeoutPadrao();
    const preparado = await controlador().prepararJob(pedido(await semearSubmissao()));

    await expect(
      controlador({
        aguardarMarcador: async () => {
          throw new Error('daemon sumiu no meio');
        },
      }).executarJob(preparado),
    ).rejects.toThrow('daemon sumiu no meio');

    expect(chamadas).toContain(`network rm fc-job-${preparado.correcaoId}_net`);

    const correcao = await prismaTeste().correcao.findFirstOrThrow();
    expect(correcao.status).toBe('falhou');
    expect(correcao.erroResumo).toContain('daemon sumiu no meio');
  });
});
