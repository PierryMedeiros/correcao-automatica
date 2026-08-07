import { estaAtiva, STATUS_SUBMISSAO, STATUS_TERMINAIS, type StatusSubmissao } from '@banca/shared';
import { describe, expect, it } from 'vitest';
import { prismaTeste } from '../setup-db.js';

const prisma = prismaTeste();

// A matriz abaixo é o guard do índice único parcial de `submissoes` (§5, §10.5). Ela existe para
// que "ativo" não possa divergir entre o SQL da migration e `estaAtiva` de `packages/shared`:
// o desfecho esperado de cada linha é calculado pela função, não escrito à mão. Estado novo entra
// na lista do §6 e este arquivo já cobra a revisão do índice.

interface Dados {
  status: StatusSubmissao;
  alunoEmail?: string;
  projeto?: string;
  fase?: string;
}

function criarSubmissao({
  status,
  alunoEmail = 'aluno@example.com',
  projeto = 'GoLang',
  fase = 'Client-Server-API',
}: Dados) {
  return prisma.submissao.create({
    data: {
      origem: 'manual',
      alunoNome: 'Aluno da Silva',
      alunoEmail,
      projeto,
      fase,
      repoUrl: 'https://github.com/aluno/desafio',
      status,
    },
  });
}

const casos = STATUS_SUBMISSAO.map((status) => ({
  status,
  ativa: estaAtiva(status),
  desfecho: estaAtiva(status) ? 'é recusada pelo índice' : 'é aceita',
}));

describe('uma submissão ativa por aluno e desafio (plan §5, §10.5)', () => {
  it.each(casos)(
    'com a anterior em $status, a nova entrega $desfecho',
    async ({ status, ativa }) => {
      await criarSubmissao({ status });

      const nova = criarSubmissao({ status: 'na_fila' });

      if (ativa) {
        await expect(nova).rejects.toMatchObject({ code: 'P2002' });
      } else {
        await expect(nova).resolves.toMatchObject({ status: 'na_fila' });
      }
    },
  );

  it('deixa o histórico crescer: duas entregas terminais do mesmo desafio convivem', async () => {
    await criarSubmissao({ status: 'enviada' });
    await criarSubmissao({ status: 'substituida' });
    await criarSubmissao({ status: 'cancelada' });

    expect(await prisma.submissao.count()).toBe(3);
  });

  it('não atrapalha o mesmo aluno em dois desafios ao mesmo tempo (§10.20)', async () => {
    await criarSubmissao({ status: 'corrigindo' });
    await criarSubmissao({ status: 'corrigindo', fase: 'Multithreading' });
    await criarSubmissao({ status: 'corrigindo', projeto: 'MBA' });

    expect(await prisma.submissao.count()).toBe(3);
  });

  it('não confunde alunos diferentes no mesmo desafio', async () => {
    await criarSubmissao({ status: 'corrigindo' });
    await criarSubmissao({ status: 'corrigindo', alunoEmail: 'outra@example.com' });

    expect(await prisma.submissao.count()).toBe(2);
  });

  // O e-mail vem colado do admin (§9.1). Sem `lower()` no índice, a mesma pessoa com outra caixa
  // abriria uma segunda submissão ativa e o §10.5 seria furado sem ninguém perceber (D10).
  it('trata o e-mail sem diferenciar caixa', async () => {
    await criarSubmissao({ status: 'aguardando_revisao', alunoEmail: 'aluno@example.com' });

    await expect(
      criarSubmissao({ status: 'na_fila', alunoEmail: 'Aluno@Example.com' }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('libera a vaga quando a anterior vira substituida — é o caminho do §10.5', async () => {
    const anterior = await criarSubmissao({ status: 'corrigindo' });

    await prisma.submissao.update({
      where: { id: anterior.id },
      data: { status: 'substituida' },
    });
    const nova = await criarSubmissao({ status: 'na_fila' });

    expect(nova.id).not.toBe(anterior.id);
  });

  it('classifica como reutilizável exatamente os três terminais de fato — nem um a mais', () => {
    const reutilizaveis = casos.filter((caso) => !caso.ativa).map((caso) => caso.status);

    expect(reutilizaveis).toEqual([...STATUS_TERMINAIS]);
  });
});

describe('no máximo um run ativo por vez (§10.21, D8)', () => {
  function criarRun(status: 'ativo' | 'pausado' | 'finalizado' | 'cancelado') {
    return prisma.run.create({
      data: { modelo: 'claude-opus-5', politicaRevisao: 'todas', status },
    });
  }

  it('recusa o segundo run ativo', async () => {
    await criarRun('ativo');

    await expect(criarRun('ativo')).rejects.toMatchObject({ code: 'P2002' });
  });

  it.each(['pausado', 'finalizado', 'cancelado'] as const)(
    'aceita quantos runs %s existirem ao lado de um ativo',
    async (status) => {
      await criarRun('ativo');
      await criarRun(status);
      await criarRun(status);

      expect(await prisma.run.count()).toBe(3);
    },
  );

  // Sem uma saída de `ativo` o sistema aceitaria exatamente um run na vida (§6.1).
  it('libera a vaga quando o run anterior é finalizado', async () => {
    const primeiro = await criarRun('ativo');

    await prisma.run.update({ where: { id: primeiro.id }, data: { status: 'finalizado' } });

    await expect(criarRun('ativo')).resolves.toMatchObject({ status: 'ativo' });
  });
});

describe('os índices parciais existem com o nome que a migration criou', () => {
  it.each(['submissoes_ativa_por_aluno_e_desafio', 'runs_no_maximo_um_ativo'])(
    '%s continua no banco',
    async (nome) => {
      const encontrados = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${nome}
      `;

      expect(encontrados).toHaveLength(1);
    },
  );
});
