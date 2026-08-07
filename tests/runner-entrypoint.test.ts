import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runnerImage } from '../apps/api/src/env.js';
import { URL_DO_BARE, criarRepoBare } from '../scripts/job-fake/repo-fixture.js';

// Teste de integração do entrypoint (F2.2): exige Docker de pé e a imagem do runner buildada.
//
// O que ele trava é o contrato do §8/§9.2 passo 4 — clone no SHA pinado, fallback shallow do
// §10.17, submodule tolerado do §10.18, `resultado.json` como marcador de fim e, o mais fácil de
// quebrar sem perceber, o runner que **continua de pé** depois da carga. Um entrypoint que
// encerrasse junto com o `claude -p` mataria o retry corretivo do §7 por construção, e nada nos
// testes de unidade perceberia.

const executar = promisify(execFile);

const LABEL = 'fc.job=teste-entrypoint';
const CODIGO_CLONE = 65;
const CODIGO_CHECKOUT = 66;
const CODIGO_PAYLOAD_AUSENTE = 67;

const imagem = runnerImage();
const jobDirs: string[] = [];
let contador = 0;

async function docker(args: string[]): Promise<string> {
  const { stdout } = await executar('docker', args, { maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

interface Marcador {
  exit_code: number;
  finished_at: string;
  motivo: string;
}

interface CloneInfo {
  shallow: boolean;
  motivo: string | null;
  submodules: { ok: boolean; erro: string | null };
}

function novoJobDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'banca-entrypoint-'));
  jobDirs.push(dir);
  return dir;
}

function escreverJobJson(jobDir: string, dados: Record<string, unknown>): void {
  writeFileSync(join(jobDir, 'job.json'), JSON.stringify(dados, null, 2), 'utf8');
}

function lerLog(jobDir: string): string {
  const log = join(jobDir, 'runner.log');
  return existsSync(log) ? readFileSync(log, 'utf8') : '(runner.log não existe)';
}

function lerJson<T>(jobDir: string, arquivo: string): T {
  return JSON.parse(readFileSync(join(jobDir, arquivo), 'utf8')) as T;
}

/** Sobe o runner do jeito que o Job Controller sobe: nome e label com o prefixo do job. */
async function subirRunner(jobDir: string, env: Record<string, string> = {}): Promise<string> {
  const nome = `fc-job-teste-${++contador}`;
  const args = ['run', '-d', '--name', nome, '--label', LABEL, '-v', `${jobDir}:/workspace`];
  for (const [chave, valor] of Object.entries({ FC_JOB_ID: nome, ...env })) {
    args.push('-e', `${chave}=${valor}`);
  }
  args.push(imagem);
  await docker(args);
  return nome;
}

/** O fim do job é o marcador, não a saída do container (§8, D10) — então é ele que se espera. */
async function esperarMarcador(jobDir: string, timeoutMs = 90_000): Promise<Marcador> {
  const alvo = join(jobDir, 'resultado.json');
  const limite = Date.now() + timeoutMs;

  while (Date.now() < limite) {
    if (existsSync(alvo)) {
      try {
        return JSON.parse(readFileSync(alvo, 'utf8')) as Marcador;
      } catch {
        // Escrita parcial: o entrypoint grava num `.parcial` e renomeia, mas quem lê nunca deve
        // confiar nisso — é a mesma tolerância que a coleta da F2.5 precisa ter.
      }
    }
    await new Promise((resolver) => setTimeout(resolver, 100));
  }

  throw new Error(`marcador não apareceu em ${timeoutMs}ms. runner.log:\n${lerLog(jobDir)}`);
}

async function statusDoContainer(nome: string): Promise<string> {
  return docker(['inspect', '-f', '{{.State.Status}}', nome]);
}

beforeAll(async () => {
  try {
    await docker(['image', 'inspect', imagem]);
  } catch {
    throw new Error(
      `a imagem ${imagem} não existe. Os testes do entrypoint rodam contra a imagem de verdade: ` +
        'rode `bash scripts/build-runner.sh` antes de `pnpm test`.',
    );
  }
}, 60_000);

afterAll(async () => {
  const ids = await docker(['ps', '-aq', '--filter', `label=${LABEL}`]);
  if (ids) await docker(['rm', '-f', ...ids.split('\n')]);
  for (const dir of jobDirs) rmSync(dir, { recursive: true, force: true });
});

describe('entrypoint do runner', () => {
  it('clona, faz checkout no SHA pinado, devolve o exit code da carga e continua de pé', async () => {
    const jobDir = novoJobDir();
    const { commitSha } = criarRepoBare(jobDir);
    escreverJobJson(jobDir, { job_id: 'teste', repo_url: URL_DO_BARE, commit_sha: commitSha });

    const nome = await subirRunner(jobDir, { FC_PAYLOAD_CMD: 'echo carga rodou; exit 3' });
    const marcador = await esperarMarcador(jobDir);

    expect(marcador.exit_code).toBe(3);
    expect(marcador.motivo).toBe('carga_concluida');
    expect(await docker(['exec', nome, 'git', '-C', '/workspace/repo', 'rev-parse', 'HEAD'])).toBe(
      commitSha,
    );
    expect(lerJson<CloneInfo>(jobDir, 'clone.json').shallow).toBe(false);
    expect(lerLog(jobDir)).toContain('carga rodou');

    // O ponto da F2.2 inteira: a carga terminou e o container NÃO morreu (§7, §8).
    expect(await statusDoContainer(nome)).toBe('running');

    // E a sentinela do job dir é o que o teardown da F2.6 vai usar para mandá-lo embora.
    writeFileSync(join(jobDir, 'encerrar'), '', 'utf8');
    const limite = Date.now() + 15_000;
    let status = 'running';
    while (status === 'running' && Date.now() < limite) {
      await new Promise((resolver) => setTimeout(resolver, 200));
      status = await statusDoContainer(nome);
    }
    expect(status).toBe('exited');
  }, 120_000);

  it('cai no clone shallow e registra o motivo em clone.json (§10.17)', async () => {
    const jobDir = novoJobDir();
    const { commitSha } = criarRepoBare(jobDir);
    escreverJobJson(jobDir, { job_id: 'teste', repo_url: URL_DO_BARE, commit_sha: commitSha });

    await subirRunner(jobDir, { FC_PAYLOAD_CMD: 'true', FC_CLONE_TIMEOUT_S: '0' });
    const marcador = await esperarMarcador(jobDir);
    const clone = lerJson<CloneInfo>(jobDir, 'clone.json');

    expect(marcador.exit_code).toBe(0);
    expect(clone.shallow).toBe(true);
    expect(clone.motivo).toBe('clone_completo_desativado');
  }, 120_000);

  it('tolera submodule quebrado e segue com o job (§10.18)', async () => {
    const jobDir = novoJobDir();
    const { commitSha } = criarRepoBare(jobDir, { comSubmoduleQuebrado: true });
    escreverJobJson(jobDir, { job_id: 'teste', repo_url: URL_DO_BARE, commit_sha: commitSha });

    await subirRunner(jobDir, { FC_PAYLOAD_CMD: 'true' });
    const marcador = await esperarMarcador(jobDir);
    const clone = lerJson<CloneInfo>(jobDir, 'clone.json');

    expect(marcador.exit_code).toBe(0);
    expect(clone.submodules.ok).toBe(false);
    expect(clone.submodules.erro).not.toBeNull();
  }, 120_000);

  it('escreve marcador e espera mesmo quando o clone falha por completo', async () => {
    const jobDir = novoJobDir();
    escreverJobJson(jobDir, {
      job_id: 'teste',
      repo_url: 'file:///workspace/repositorio-que-nao-existe.git',
      commit_sha: null,
    });

    const nome = await subirRunner(jobDir, { FC_PAYLOAD_CMD: 'true' });
    const marcador = await esperarMarcador(jobDir);

    expect(marcador.exit_code).toBe(CODIGO_CLONE);
    expect(marcador.motivo).toBe('clone_falhou');
    // Quem derruba o runner é sempre o host: nem a falha de clone o faz sair sozinho.
    expect(await statusDoContainer(nome)).toBe('running');
  }, 120_000);

  it('tem código próprio para SHA que não existe no clone', async () => {
    const jobDir = novoJobDir();
    criarRepoBare(jobDir);
    escreverJobJson(jobDir, {
      job_id: 'teste',
      repo_url: URL_DO_BARE,
      commit_sha: '0000000000000000000000000000000000000000',
    });

    await subirRunner(jobDir, { FC_PAYLOAD_CMD: 'true' });

    expect((await esperarMarcador(jobDir)).exit_code).toBe(CODIGO_CHECKOUT);
  }, 120_000);

  it('sem FC_PAYLOAD_CMD, diz por quê no marcador em vez de encerrar em silêncio', async () => {
    const jobDir = novoJobDir();
    const { commitSha } = criarRepoBare(jobDir);
    escreverJobJson(jobDir, { job_id: 'teste', repo_url: URL_DO_BARE, commit_sha: commitSha });

    const nome = await subirRunner(jobDir);
    const marcador = await esperarMarcador(jobDir);

    expect(marcador.exit_code).toBe(CODIGO_PAYLOAD_AUSENTE);
    expect(marcador.motivo).toBe('payload_ausente');
    expect(await statusDoContainer(nome)).toBe('running');
  }, 120_000);
});
