import { describe, expect, it } from 'vitest';
import { prismaTeste } from '../setup-db.js';

const prisma = prismaTeste();

describe('eventos — auditoria append-only (§5, §12)', () => {
  // Pausa global e ações de run são eventos do sistema, não de uma submissão (D9 da F1).
  it('aceita evento sem submissão', async () => {
    const evento = await prisma.evento.create({
      data: { tipo: 'sistema.pausa', payload: { motivo: 'limite_plano' } },
    });

    expect(evento.submissaoId).toBeNull();
    expect(evento.payload).toEqual({ motivo: 'limite_plano' });
  });

  it('nasce com payload vazio quando o evento não carrega dado nenhum', async () => {
    const evento = await prisma.evento.create({ data: { tipo: 'run.retomado' } });

    expect(evento.payload).toEqual({});
  });

  it('lê a timeline de uma submissão em ordem cronológica (§9.3)', async () => {
    const submissao = await prisma.submissao.create({
      data: {
        origem: 'manual',
        alunoNome: 'Aluno',
        alunoEmail: 'aluno@example.com',
        projeto: 'GoLang',
        fase: 'Client-Server-API',
        repoUrl: 'https://github.com/aluno/repo',
        status: 'na_fila',
      },
    });

    await prisma.evento.create({
      data: {
        submissaoId: submissao.id,
        tipo: 'submissao.criada',
        ts: new Date('2026-08-07T10:00:00Z'),
      },
    });
    await prisma.evento.create({
      data: {
        submissaoId: submissao.id,
        tipo: 'submissao.na_fila',
        ts: new Date('2026-08-07T10:00:05Z'),
      },
    });
    await prisma.evento.create({ data: { tipo: 'sistema.pausa' } });

    const timeline = await prisma.evento.findMany({
      where: { submissaoId: submissao.id },
      orderBy: { ts: 'asc' },
    });

    expect(timeline.map((e) => e.tipo)).toEqual(['submissao.criada', 'submissao.na_fila']);
  });
});

describe('notificacoes (§5)', () => {
  it('nasce não lida — quem lê é o humano, não o insert', async () => {
    const notificacao = await prisma.notificacao.create({
      data: { tipo: 'sem_skill', texto: 'Desafio sem skill mapeada' },
    });

    expect(notificacao.lida).toBe(false);
    expect(notificacao.link).toBeNull();
  });
});

describe('webhook_payloads (§3, §5)', () => {
  it('guarda o corpo exatamente como chegou, mesmo não sendo JSON válido', async () => {
    const bruto = '{"isso": nao é json}';

    const capturado = await prisma.webhookPayload.create({
      data: { headers: { 'content-type': 'application/json' }, body: bruto },
    });

    expect(capturado.body).toBe(bruto);
  });

  it('nasce vazia: quem a preenche é o receptor, que não existe nesta fase', async () => {
    expect(await prisma.webhookPayload.count()).toBe(0);
  });
});

describe('config (§5, §12)', () => {
  it('recusa a mesma chave duas vezes — a chave é a PK', async () => {
    await prisma.config.create({
      data: { chave: 'pausa_global', valor: { ativa: false }, descricao: '§12' },
    });

    await expect(
      prisma.config.create({
        data: { chave: 'pausa_global', valor: { ativa: true }, descricao: '§12' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('guarda número, booleano, texto e objeto na mesma coluna (D5: jsonb)', async () => {
    await prisma.config.createMany({
      data: [
        { chave: 'numero', valor: 1500, descricao: '§10.9' },
        { chave: 'booleano', valor: true, descricao: 'teste' },
        { chave: 'texto', valor: 'olá, %motivo%', descricao: '§6' },
        { chave: 'lista', valor: [5, 15, 30, 60], descricao: '§10.10' },
        { chave: 'objeto', valor: { ativa: false, motivo: null }, descricao: '§12' },
      ],
    });

    const linhas = await prisma.config.findMany({ orderBy: { chave: 'asc' } });

    expect(linhas.map((l) => l.valor)).toEqual([
      true,
      [5, 15, 30, 60],
      1500,
      { ativa: false, motivo: null },
      'olá, %motivo%',
    ]);
  });
});
