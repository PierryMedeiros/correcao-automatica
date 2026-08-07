import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Logger } from '../log.js';

// Fronteira externa com o Docker (CLAUDE.md): `execFile`, nunca string de shell.
//
// Não é preciosismo — os argumentos carregam dado externo (URL de repositório colada pelo aluno,
// nome de skill, caminho de job dir). Concatenar isso numa linha de shell é injeção esperando
// acontecer, e o processo que a executaria tem o socket do Docker à mão (§11).
//
// Toda chamada tem timeout: o `docker` pode ficar pendurado esperando um daemon que não responde,
// e um Job Controller travado nesse ponto não roda teardown nem coleta.

const executarArquivo = promisify(execFile);

export const TIMEOUT_PADRAO_MS = 30_000;

export interface ResultadoDocker {
  stdout: string;
  stderr: string;
}

export interface OpcoesDocker {
  timeoutMs?: number;
  /** Quando a falha é esperada (remover o que talvez não exista), o chamador trata o erro. */
  toleraFalha?: boolean;
}

export type DockerCli = (args: string[], opcoes?: OpcoesDocker) => Promise<ResultadoDocker>;

export class DockerError extends Error {
  constructor(
    readonly args: string[],
    readonly codigo: number | null,
    readonly stderr: string,
  ) {
    super(`docker ${args.join(' ')} falhou (código ${codigo ?? 'nulo'}): ${stderr.trim()}`);
    this.name = 'DockerError';
  }
}

interface ErroDeExec extends Error {
  code?: number | string;
  killed?: boolean;
  stderr?: string;
  stdout?: string;
}

export function criarDockerCli(logger: Logger, timeoutPadraoMs = TIMEOUT_PADRAO_MS): DockerCli {
  return async function docker(args, opcoes = {}) {
    const timeoutMs = opcoes.timeoutMs ?? timeoutPadraoMs;
    const inicio = process.hrtime.bigint();

    try {
      const { stdout, stderr } = await executarArquivo('docker', args, {
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
      });
      const duracaoMs = Number((process.hrtime.bigint() - inicio) / 1_000_000n);
      logger.debug({ docker: args, duracao_ms: duracaoMs }, 'docker ok');
      return { stdout, stderr };
    } catch (erro) {
      const falha = erro as ErroDeExec;
      const codigo = typeof falha.code === 'number' ? falha.code : null;
      const detalhe = falha.killed
        ? `sem resposta em ${timeoutMs}ms: ${falha.stderr ?? ''}`
        : (falha.stderr ?? falha.message);

      // `args` é registrado sempre: é o único jeito de reproduzir a falha à mão depois. O valor do
      // token nunca está aí — ele entra como `-e CLAUDE_CODE_OAUTH_TOKEN`, sem `=valor`.
      logger[opcoes.toleraFalha ? 'debug' : 'error'](
        { docker: args, codigo, erro: detalhe },
        'docker falhou',
      );
      throw new DockerError(args, codigo, detalhe);
    }
  };
}
