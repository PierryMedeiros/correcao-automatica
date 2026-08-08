import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prismaTeste } from '../../tests/setup-db.js';
import { criarLogger } from '../log.js';
import type { DockerCli } from './docker.js';
import { EVENTO_ORFA, MOTIVO_ORFA, criarRecuperacao } from './recuperacao.js';
import { criarTeardown, type ResultadoDoTeardown, type Teardown } from './teardown.js';

// O que este arquivo trava é o §10.12 e o contrato que a F4 vai consumir.
//
// A falha silenciosa aqui é uma correção que fica `rodando` para sempre: a submissão dela nunca
// volta para a fila, ninguém é notificado, e o card mostra "corrigindo" indefinidamente. A outra é
// apagar o job dir junto — perdendo o `runner.log` que explica até onde o job foi antes da queda.

let jobsDir: string;
let abortados: string[];

function logSilencioso() {
  return criarLogger(
    new Writable({
      write(_pedaco, _codificacao, pronto) {
        pronto();
      },
    }),
  );
}

function teardownFalso(): Teardown {
  abortados = [];
  const vazio = (correcaoId: string): ResultadoDoTeardown => ({
    correcaoId,
    containersRemovidos: [],
    networksRemovidas: [],
    volumesRemovidos: [],
    erros: [],
  });

  return {
    async encerrar(id) {
      return vazio(id);
    },
    async abortar(id) {
      abortados.push(id);
      return vazio(id);
    },
  };
}

function recuperacaoCom(teardown: Teardown) {
  return criarRecuperacao({ prisma: prismaTeste(), teardown, logger: logSilencioso() });
}

async function semearCorrecao(status: 'rodando' | 'concluida'): Promise<{ correcaoId: string }> {
  const submissao = await prismaTeste().submissao.create({
    data: {
      origem: 'manual',
      alunoNome: 'Aluno de Teste',
      alunoEmail: `aluno-${status}-${Math.random()}@exemplo.invalido`,
      projeto: 'GoLang',
      fase: 'Client-Server-API',
      repoUrl: 'https://github.com/exemplo/entrega.git',
      status: 'corrigindo',
    },
  });

  const correcao = await prismaTeste().correcao.create({
    data: {
      submissaoId: submissao.id,
      retryN: 1,
      status,
      modelo: 'fake',
      transcriptPath: join(jobsDir, '0', 'transcript.jsonl'),
    },
  });

  const correcaoId = correcao.id.toString();
  mkdirSync(join(jobsDir, correcaoId), { recursive: true });
  writeFileSync(join(jobsDir, correcaoId, 'runner.log'), 'até onde o job foi\n', 'utf8');

  return { correcaoId };
}

beforeEach(() => {
  jobsDir = mkdtempSync(join(tmpdir(), 'banca-recuperacao-'));
});

afterEach(() => {
  rmSync(jobsDir, { recursive: true, force: true });
});

describe('recuperação de órfãos no boot (§10.12)', () => {
  it('marca toda correção `rodando` como `falhou` com o motivo exato', async () => {
    const { correcaoId } = await semearCorrecao('rodando');

    await recuperacaoCom(teardownFalso()).recuperarCorrecoesOrfas();

    const correcao = await prismaTeste().correcao.findUniqueOrThrow({
      where: { id: BigInt(correcaoId) },
    });
    expect(correcao.status).toBe('falhou');
    expect(correcao.erroResumo).toBe(MOTIVO_ORFA);
    expect(correcao.finishedAt).not.toBeNull();
    expect(correcao.duracaoS).not.toBeNull();
  });

  it('aborta os recursos Docker de cada órfã — inclusive as de container ainda vivo', async () => {
    const primeira = await semearCorrecao('rodando');
    const segunda = await semearCorrecao('rodando');

    await recuperacaoCom(teardownFalso()).recuperarCorrecoesOrfas();

    expect(abortados).toEqual([primeira.correcaoId, segunda.correcaoId]);
  });

  it('devolve correcao_id e submissao_id de cada uma, que é o que a F4 percorre', async () => {
    const { correcaoId } = await semearCorrecao('rodando');

    const recuperadas = await recuperacaoCom(teardownFalso()).recuperarCorrecoesOrfas();

    expect(recuperadas).toHaveLength(1);
    expect(recuperadas[0]?.correcaoId).toBe(correcaoId);
    expect(recuperadas[0]?.submissaoId).toMatch(/^\d+$/);
    expect(recuperadas[0]?.retryN).toBe(1);
  });

  it('registra a recuperação em `eventos`, ligada à submissão (auditoria, §12)', async () => {
    const { correcaoId } = await semearCorrecao('rodando');

    await recuperacaoCom(teardownFalso()).recuperarCorrecoesOrfas();

    const evento = await prismaTeste().evento.findFirstOrThrow({ where: { tipo: EVENTO_ORFA } });
    expect(evento.submissaoId).not.toBeNull();
    expect(evento.payload).toMatchObject({ correcao_id: correcaoId, motivo: MOTIVO_ORFA });
  });

  it('não toca em correção que já tinha desfecho', async () => {
    const { correcaoId } = await semearCorrecao('concluida');

    const recuperadas = await recuperacaoCom(teardownFalso()).recuperarCorrecoesOrfas();

    expect(recuperadas).toEqual([]);
    const correcao = await prismaTeste().correcao.findUniqueOrThrow({
      where: { id: BigInt(correcaoId) },
    });
    expect(correcao.status).toBe('concluida');
  });

  it('a segunda execução devolve lista vazia: não sobrou nada `rodando`', async () => {
    await semearCorrecao('rodando');
    const recuperacao = recuperacaoCom(teardownFalso());

    expect(await recuperacao.recuperarCorrecoesOrfas()).toHaveLength(1);
    expect(await recuperacao.recuperarCorrecoesOrfas()).toEqual([]);
  });

  it('preserva o job dir: a correção existe, logo o dir é referenciado (§11)', async () => {
    const { correcaoId } = await semearCorrecao('rodando');
    const docker: DockerCli = async () => ({ stdout: '', stderr: '' });

    await recuperacaoCom(
      criarTeardown({ docker, logger: logSilencioso(), jobsDir }),
    ).recuperarCorrecoesOrfas();

    expect(existsSync(join(jobsDir, correcaoId, 'runner.log'))).toBe(true);
  });
});
