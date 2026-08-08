import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { criarLogger } from '../log.js';
import type { DockerCli, ResultadoDocker } from './docker.js';
import { criarTeardown } from './teardown.js';

// O que este arquivo trava é o §8 camada 2 e a regra dura 1.
//
// Duas falhas moram aqui e nenhuma faz barulho: teardown que remove antes de sinalizar deixa o
// runner sem chance de fechar o log, e remoção sem filtro do job apaga recurso de terceiro na
// máquina do usuário. A ordem e o escopo por label são contrato, não estilo.

const CORRECAO = '42';
const RUNNER = 'fc-job-42';
const NETWORK = 'fc-job-42_net';

let jobsDir: string;
let chamadas: string[][];

interface DockerFalso {
  cli: DockerCli;
  chamadas: string[][];
}

/** `respostas`/`falhas` casam por prefixo do comando; o resto sai vazio e com sucesso. */
function dockerFalso(
  respostas: Record<string, string> = {},
  falhas: Record<string, string> = {},
): DockerFalso {
  const registradas: string[][] = [];

  const cli: DockerCli = async (args): Promise<ResultadoDocker> => {
    registradas.push(args);
    const linha = args.join(' ');

    for (const [prefixo, mensagem] of Object.entries(falhas)) {
      if (linha.startsWith(prefixo)) throw new Error(mensagem);
    }
    for (const [prefixo, saida] of Object.entries(respostas)) {
      if (linha.startsWith(prefixo)) return { stdout: saida, stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };

  return { cli, chamadas: registradas };
}

function teardownCom(docker: DockerFalso) {
  chamadas = docker.chamadas;
  const destino = new Writable({
    write(_pedaco, _codificacao, pronto) {
      pronto();
    },
  });
  return criarTeardown({ docker: docker.cli, logger: criarLogger(destino), jobsDir });
}

function linhas(): string[] {
  return chamadas.map((args) => args.join(' '));
}

/** O daemon quando o recurso não existe — o caso normal do segundo teardown. */
const AUSENTES = {
  stop: 'Error response from daemon: No such container: fc-job-42',
  rm: 'Error response from daemon: No such container: fc-job-42',
  'network inspect': 'Error response from daemon: network fc-job-42_net not found',
  'volume rm': 'Error response from daemon: get x: no such volume',
};

beforeEach(() => {
  jobsDir = mkdtempSync(join(tmpdir(), 'banca-teardown-'));
  mkdirSync(join(jobsDir, CORRECAO));
  writeFileSync(join(jobsDir, CORRECAO, 'runner.log'), 'log do job\n', 'utf8');
});

afterEach(() => {
  rmSync(jobsDir, { recursive: true, force: true });
});

describe('teardown do §8 camada 2', () => {
  it('sinaliza o encerramento ao runner antes de remover qualquer coisa (D10)', async () => {
    await teardownCom(dockerFalso()).encerrar(CORRECAO);

    expect(existsSync(join(jobsDir, CORRECAO, 'encerrar'))).toBe(true);

    const ordem = linhas();
    const stop = ordem.findIndex((c) => c.startsWith('stop '));
    const primeiraRemocao = ordem.findIndex((c) => c.includes('down') || c.startsWith('rm '));

    expect(stop).toBeGreaterThanOrEqual(0);
    expect(stop).toBeLessThan(primeiraRemocao);
  });

  it('segue a ordem das camadas: stack do aluno, runner, network, volumes', async () => {
    await teardownCom(
      dockerFalso({
        'ps -aq --filter label=': 'abc123\ndef456\n',
        'ps -aq --filter name=': `${RUNNER}\n`,
        'volume ls': 'fc-job-42_dados\n',
      }),
    ).encerrar(CORRECAO);

    const ordem = linhas();
    const posicao = (trecho: string) => ordem.findIndex((c) => c.includes(trecho));

    // `--rmi local` remove as imagens que a stack buildou (`fc-job-42-app`), que `down` sozinho
    // deixa no disco; `local` e não `all`, que levaria junto o `postgres:16` da máquina inteira.
    expect(linhas()).toContain('compose -p fc-job-42 down -v --rmi local --remove-orphans');
    expect(posicao('compose -p fc-job-42 down')).toBeLessThan(posicao('rm -f abc123'));
    expect(posicao('rm -f abc123')).toBeLessThan(posicao(`rm -f ${RUNNER}`));
    expect(posicao(`rm -f ${RUNNER}`)).toBeLessThan(posicao(`network rm ${NETWORK}`));
    expect(posicao(`network rm ${NETWORK}`)).toBeLessThan(posicao('volume rm'));
  });

  it('remove a network do job e as que o compose rotulou, sem tocar em outras', async () => {
    const resultado = await teardownCom(
      dockerFalso({ 'network ls': 'fc-job-42_interna\n' }),
    ).encerrar(CORRECAO);

    expect(resultado.networksRemovidas).toEqual([NETWORK, 'fc-job-42_interna']);
  });

  it('desconecta endpoint teimoso antes de remover a network', async () => {
    await teardownCom(dockerFalso({ 'network inspect': 'container-de-fora\n' })).encerrar(CORRECAO);

    expect(linhas()).toContain(`network disconnect -f ${NETWORK} container-de-fora`);
  });

  it('não conta como removido o runner que já não existia — `docker rm -f` sai 0 nesse caso', async () => {
    const resultado = await teardownCom(dockerFalso()).encerrar(CORRECAO);

    // O número vai para `eventos` na recuperação de órfãos (§12): relatório que infla remoção
    // faz a auditoria afirmar que havia container de pé onde não havia.
    expect(resultado.containersRemovidos).toEqual([]);
    expect(linhas()).not.toContain(`rm -f ${RUNNER}`);
  });

  it('nenhuma remoção acontece fora do escopo do job (regra dura 1 e 2)', async () => {
    await teardownCom(
      dockerFalso({
        'ps -aq --filter label=': 'abc123\n',
        'ps -aq --filter name=': `${RUNNER}\n`,
        'volume ls': 'fc-job-42_dados\n',
      }),
    ).encerrar(CORRECAO);

    for (const args of chamadas) {
      const linha = args.join(' ');
      expect(linha).not.toContain('prune');

      const ehListagem = linha.includes(' ls') || linha.includes('ps -aq');
      const ehRemocao = args.includes('rm') || args.includes('-f');
      if (!ehRemocao || ehListagem) continue;

      // Ou o alvo é nomeado pelo job, ou ele veio de uma listagem filtrada pelo label dele.
      const escopado =
        linha.includes(`fc-job-${CORRECAO}`) ||
        linha.includes(`fc.job=${CORRECAO}`) ||
        linha.includes('abc123');
      expect(escopado, `remoção fora do escopo do job: ${linha}`).toBe(true);
    }
  });

  it('é idempotente: a segunda execução não acha nada e não reporta erro', async () => {
    const resultado = await teardownCom(dockerFalso({}, AUSENTES)).encerrar(CORRECAO);

    expect(resultado.erros).toEqual([]);
    expect(resultado.containersRemovidos).toEqual([]);
    expect(resultado.networksRemovidas).toEqual([]);
  });

  it('falha de verdade entra no relatório, e os passos seguintes continuam', async () => {
    const resultado = await teardownCom(
      dockerFalso(
        { 'ps -aq --filter name=': `${RUNNER}\n` },
        { 'compose -p': 'Cannot connect to the Docker daemon' },
      ),
    ).encerrar(CORRECAO);

    expect(resultado.erros).toHaveLength(1);
    expect(resultado.erros[0]).toContain('compose down');
    expect(linhas()).toContain(`rm -f ${RUNNER}`);
  });

  it('nunca apaga o job dir — limpeza de disco é do janitor (§11)', async () => {
    await teardownCom(dockerFalso()).encerrar(CORRECAO);

    expect(existsSync(join(jobsDir, CORRECAO, 'runner.log'))).toBe(true);
  });

  it('abortar mata o runner antes de tudo, e é a primitiva que a F4 consome', async () => {
    await teardownCom(dockerFalso()).abortar(CORRECAO);

    expect(linhas()[0]).toBe(`kill ${RUNNER}`);
  });
});
