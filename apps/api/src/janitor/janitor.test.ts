import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prismaTeste } from '../../tests/setup-db.js';
import type { PrismaClient } from '../db/client.js';
import type { DockerCli } from '../jobs/docker.js';
import { criarLogger } from '../log.js';
import { criarJanitor, identificarJob, type DepsDoJanitor } from './janitor.js';

// O que este arquivo trava é o §11 e o fail-safe.
//
// Os dois erros possíveis aqui são assimétricos: preservar demais custa disco, apagar demais custa
// a auditoria de uma correção que falhou — irreversível. Por isso os testes de preservação são
// tantos quanto os de remoção, e o de "banco indisponível" é o mais importante de todos.

const AGORA = new Date('2026-08-07T12:00:00Z');
const UM_DIA_MS = 24 * 60 * 60 * 1_000;

let jobsDir: string;
let comandos: string[][];

function logSilencioso() {
  return criarLogger(
    new Writable({
      write(_pedaco, _codificacao, pronto) {
        pronto();
      },
    }),
  );
}

function dockerFalso(respostas: Record<string, string> = {}): DockerCli {
  return async (args) => {
    comandos.push(args);
    const linha = args.join(' ');
    for (const [prefixo, saida] of Object.entries(respostas)) {
      if (linha.startsWith(prefixo)) return { stdout: saida, stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };
}

function janitorCom(opcoes: Partial<DepsDoJanitor> = {}) {
  return criarJanitor({
    prisma: prismaTeste(),
    docker: dockerFalso(),
    logger: logSilencioso(),
    jobsDir,
    agora: () => AGORA,
    espacoLivreGb: () => 100,
    ...opcoes,
  });
}

async function semearLimiares(): Promise<void> {
  await prismaTeste().config.createMany({
    data: [
      { chave: 'retencao_job_dir_dias', valor: 14, descricao: 'fixture' },
      { chave: 'disco_alerta_gb', valor: 15, descricao: 'fixture' },
      { chave: 'disco_pausa_gb', valor: 5, descricao: 'fixture' },
      {
        chave: 'pausa_global',
        valor: { ativa: false, motivo: null, desde: null, tentativas: 0 },
        descricao: 'fixture',
      },
    ],
  });
}

/** Cria a correção e o job dir dela, com a idade que o teste precisa. */
async function semearJobDir(opcoes: {
  status: 'rodando' | 'concluida' | 'falhou';
  diasAtras?: number;
}): Promise<string> {
  const submissao = await prismaTeste().submissao.create({
    data: {
      origem: 'manual',
      alunoNome: 'Aluno de Teste',
      alunoEmail: `aluno-${Math.random()}@exemplo.invalido`,
      projeto: 'GoLang',
      fase: 'Client-Server-API',
      repoUrl: 'https://github.com/exemplo/entrega.git',
      status: 'corrigindo',
    },
  });

  const fim =
    opcoes.diasAtras === undefined
      ? null
      : new Date(AGORA.getTime() - opcoes.diasAtras * UM_DIA_MS);

  const correcao = await prismaTeste().correcao.create({
    data: {
      submissaoId: submissao.id,
      retryN: 1,
      status: opcoes.status,
      modelo: 'fake',
      transcriptPath: 'x',
      finishedAt: fim,
    },
  });

  const id = correcao.id.toString();
  mkdirSync(join(jobsDir, id), { recursive: true });
  writeFileSync(join(jobsDir, id, 'runner.log'), 'log\n', 'utf8');
  return id;
}

function criarDirSolto(nome: string): string {
  mkdirSync(join(jobsDir, nome), { recursive: true });
  return join(jobsDir, nome);
}

beforeEach(() => {
  jobsDir = mkdtempSync(join(tmpdir(), 'banca-janitor-'));
  comandos = [];
});

afterEach(() => {
  rmSync(jobsDir, { recursive: true, force: true });
});

describe('identificação do dono de um recurso Docker', () => {
  it('reconhece o label do sistema, o do compose e o prefixo do nome', () => {
    expect(identificarJob('fc-job-7', 'fc.job=7,outra=coisa')).toBe('7');
    expect(identificarJob('qualquer', 'com.docker.compose.project=fc-job-9')).toBe('9');
    expect(identificarJob('fc-job-12_net', '')).toBe('12');
    expect(identificarJob('fc-job-12-app-1', '')).toBe('12');
  });

  it('devolve null para o que não é nosso — é isso que protege o resto da máquina', () => {
    expect(
      identificarJob('postgres-do-usuario', 'com.docker.compose.project=outro-projeto'),
    ).toBeNull();
    expect(identificarJob('banca-dev-db-1', 'com.docker.compose.project=banca-dev')).toBeNull();
    expect(identificarJob('nginx', '')).toBeNull();
  });
});

describe('varredura de recursos Docker', () => {
  it('remove container, network e volume de job que não está mais em execução', async () => {
    await semearLimiares();

    const relatorio = await janitorCom({
      docker: dockerFalso({
        'ps -a': 'abc\tfc-job-3\tfc.job=3\ndef\tnginx\t\n',
        'network ls': 'n1\tfc-job-3_net\tfc.job=3\n',
        'volume ls': 'fc-job-3_dados\tfc-job-3_dados\tfc.job=3\n',
      }),
    }).executarCiclo();

    expect(relatorio.containersRemovidos.map((r) => r.nome)).toEqual(['fc-job-3']);
    expect(relatorio.networksRemovidas.map((r) => r.nome)).toEqual(['fc-job-3_net']);
    expect(relatorio.volumesRemovidos.map((r) => r.nome)).toEqual(['fc-job-3_dados']);
    expect(comandos.map((c) => c.join(' '))).not.toContain('rm -f def');
  });

  it('preserva o que é de correção `rodando` — job em execução não é resto', async () => {
    await semearLimiares();
    const emVoo = await semearJobDir({ status: 'rodando' });

    const relatorio = await janitorCom({
      docker: dockerFalso({ 'ps -a': `abc\tfc-job-${emVoo}\tfc.job=${emVoo}\n` }),
    }).executarCiclo();

    expect(relatorio.containersRemovidos).toEqual([]);
    expect(existsSync(join(jobsDir, emVoo))).toBe(true);
  });

  it('nunca usa prune, nem filtrado (regra dura 1, D8)', async () => {
    await semearLimiares();
    await janitorCom().executarCiclo();

    for (const args of comandos) expect(args.join(' ')).not.toContain('prune');
  });

  it('remove a imagem que a stack do aluno buildou e NÃO toca em imagem de outro projeto', async () => {
    await semearLimiares();

    // A máquina é de trabalho: a listagem de imagens do daemon traz os outros projetos do operador,
    // inclusive build intermediário sem tag. Só o prefixo `fc-job-` é nosso (Apêndice B v1.9).
    const relatorio = await janitorCom({
      docker: dockerFalso({
        images:
          'aaa\tfc-job-3-app:latest\tfc-job-3-app\n' +
          'bbb\t<none>:<none>\t<none>\n' +
          'ccc\tminha-outra-api:dev\tminha-outra-api\n' +
          'ddd\tpostgres:16\tpostgres\n',
      }),
    }).executarCiclo();

    expect(relatorio.imagensRemovidas).toEqual(['fc-job-3-app:latest']);

    const linhas = comandos.map((c) => c.join(' '));
    expect(linhas).toContain('rmi aaa');
    for (const alheia of ['rmi bbb', 'rmi ccc', 'rmi ddd']) expect(linhas).not.toContain(alheia);
  });

  it('preserva a imagem de job em execução', async () => {
    await semearLimiares();
    const emVoo = await semearJobDir({ status: 'rodando' });

    const relatorio = await janitorCom({
      docker: dockerFalso({
        images: `aaa\tfc-job-${emVoo}-app:latest\tfc-job-${emVoo}-app\n`,
      }),
    }).executarCiclo();

    expect(relatorio.imagensRemovidas).toEqual([]);
  });
});

describe('retenção de job dirs (§11)', () => {
  it('órfão sai no ciclo, sem olhar idade', async () => {
    await semearLimiares();
    const orfao = criarDirSolto('999');

    const relatorio = await janitorCom().executarCiclo();

    expect(existsSync(orfao)).toBe(false);
    expect(relatorio.jobDirsRemovidos[0]?.motivo).toContain('órfão');
  });

  it('referenciado por correção `falhou` de 1 dia permanece — apagá-lo é o bug', async () => {
    await semearLimiares();
    const id = await semearJobDir({ status: 'falhou', diasAtras: 1 });

    const relatorio = await janitorCom().executarCiclo();

    expect(existsSync(join(jobsDir, id))).toBe(true);
    expect(relatorio.jobDirsPreservados[0]?.motivo).toContain('falhou');
  });

  it('referenciado com 15 dias sai', async () => {
    await semearLimiares();
    const id = await semearJobDir({ status: 'falhou', diasAtras: 15 });

    await janitorCom().executarCiclo();

    expect(existsSync(join(jobsDir, id))).toBe(false);
  });

  it('diretório cujo nome não é id de correção é preservado, não tratado como órfão', async () => {
    await semearLimiares();
    const spike = criarDirSolto('s1');

    const relatorio = await janitorCom().executarCiclo();

    expect(existsSync(spike)).toBe(true);
    expect(relatorio.jobDirsPreservados[0]?.motivo).toContain('não é id de correção');
  });
});

describe('fail-safe', () => {
  it('banco indisponível cancela o ciclo inteiro: zero remoção', async () => {
    const orfao = criarDirSolto('999');
    const prismaQuebrado = {
      correcao: {
        findMany: async () => {
          throw new Error('connection refused');
        },
      },
    } as unknown as PrismaClient;

    const relatorio = await janitorCom({
      prisma: prismaQuebrado,
      docker: dockerFalso({ 'ps -a': 'abc\tfc-job-3\tfc.job=3\n' }),
    }).executarCiclo();

    expect(existsSync(orfao)).toBe(true);
    expect(relatorio.containersRemovidos).toEqual([]);
    expect(comandos).toEqual([]);
    expect(relatorio.erros[0]).toContain('nenhum recurso foi removido');
  });
});

describe('vigilância de disco (§10.19)', () => {
  it('alerta abaixo do limiar de alerta, sem pausar', async () => {
    await semearLimiares();

    const relatorio = await janitorCom({ espacoLivreGb: () => 10 }).executarCiclo();

    expect(relatorio.disco?.alerta).toBe(true);
    expect(relatorio.disco?.pausaEscrita).toBe(false);
  });

  it('abaixo do limiar de pausa grava `pausa_global` como objeto com os quatro campos (D9)', async () => {
    await semearLimiares();

    const relatorio = await janitorCom({ espacoLivreGb: () => 2 }).executarCiclo();

    expect(relatorio.disco?.pausaEscrita).toBe(true);
    const pausa = await prismaTeste().config.findUniqueOrThrow({
      where: { chave: 'pausa_global' },
    });
    expect(pausa.valor).toEqual({
      ativa: true,
      motivo: 'disco',
      desde: AGORA.toISOString(),
      tentativas: 0,
    });
    expect(await prismaTeste().notificacao.count()).toBe(1);
  });

  it('não sobrescreve uma pausa já ativa de outro motivo', async () => {
    await semearLimiares();
    await prismaTeste().config.update({
      where: { chave: 'pausa_global' },
      data: { valor: { ativa: true, motivo: 'limite_plano', desde: 'ontem', tentativas: 2 } },
    });

    await janitorCom({ espacoLivreGb: () => 2 }).executarCiclo();

    const pausa = await prismaTeste().config.findUniqueOrThrow({
      where: { chave: 'pausa_global' },
    });
    expect(pausa.valor).toMatchObject({ motivo: 'limite_plano', tentativas: 2 });
  });
});
