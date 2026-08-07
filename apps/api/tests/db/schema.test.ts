import {
  MODOS_AVALIACAO,
  ORIGENS_SUBMISSAO,
  POLITICAS_REVISAO,
  STATUS_CORRECAO,
  STATUS_RUN,
  STATUS_SUBMISSAO,
  VEREDITOS,
} from '@banca/shared';
import { describe, expect, it } from 'vitest';
import { prismaTeste } from '../setup-db.js';

const prisma = prismaTeste();

// `packages/shared` é o dono dos enums de domínio e o schema Prisma os replica no enum nativo do
// Postgres — o front não pode depender do client Prisma (D4 da F1). Ninguém garante em tempo de
// compilação que as duas listas continuem iguais, então quem garante é este arquivo: acrescentar
// valor em um lado sem acrescentar no outro quebra o build.
const ENUMS_ESPERADOS: Record<string, readonly string[]> = {
  modo_avaliacao: MODOS_AVALIACAO,
  origem_submissao: ORIGENS_SUBMISSAO,
  status_submissao: STATUS_SUBMISSAO,
  status_correcao: STATUS_CORRECAO,
  veredito: VEREDITOS,
  politica_revisao: POLITICAS_REVISAO,
  status_run: STATUS_RUN,
};

async function enumsDoBanco(): Promise<Map<string, string[]>> {
  const linhas = await prisma.$queryRaw<{ tipo: string; valor: string }[]>`
    SELECT t.typname AS tipo, e.enumlabel AS valor
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    ORDER BY t.typname, e.enumsortorder
  `;

  const porTipo = new Map<string, string[]>();
  for (const { tipo, valor } of linhas) {
    porTipo.set(tipo, [...(porTipo.get(tipo) ?? []), valor]);
  }
  return porTipo;
}

async function colunas(tabela: string): Promise<string[]> {
  const linhas = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tabela}
  `;
  return linhas.map((l) => l.column_name);
}

describe('enums do Postgres × packages/shared (D4 da F1)', () => {
  it('o banco tem exatamente os tipos enum que o domínio declara — nem a mais, nem a menos', async () => {
    const doBanco = await enumsDoBanco();

    expect([...doBanco.keys()].sort()).toEqual(Object.keys(ENUMS_ESPERADOS).sort());
  });

  it.each(Object.entries(ENUMS_ESPERADOS))(
    'o enum %s tem os mesmos valores, na mesma ordem, dos dois lados',
    async (tipo, esperados) => {
      const doBanco = await enumsDoBanco();

      expect(doBanco.get(tipo)).toEqual([...esperados]);
    },
  );

  it('status_submissao tem os 12 estados do §6 — estado novo exige plano antes (regra dura 3)', async () => {
    const doBanco = await enumsDoBanco();

    expect(doBanco.get('status_submissao')).toHaveLength(12);
  });
});

describe('PII: o celular do aluno nunca chega ao banco (regra dura 6, §11)', () => {
  it('nenhuma tabela tem coluna de celular ou telefone', async () => {
    const proibidas = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (column_name ILIKE '%celular%' OR column_name ILIKE '%telefone%'
             OR column_name ILIKE '%phone%')
    `;

    expect(proibidas).toEqual([]);
  });

  it('submissoes guarda nome e e-mail, que o fluxo exige, e mais nada de contato', async () => {
    const nomes = await colunas('submissoes');

    expect(nomes).toContain('aluno_nome');
    expect(nomes).toContain('aluno_email');
  });
});

describe('devolutivas (§5)', () => {
  it('nasce sem correção quando o caso é link_invalido (Apêndice B v1.3 item 2)', async () => {
    const submissao = await prisma.submissao.create({
      data: {
        origem: 'manual',
        alunoNome: 'Aluno',
        alunoEmail: 'aluno@example.com',
        projeto: 'GoLang',
        fase: 'Client-Server-API',
        repoUrl: 'https://github.com/aluno/repo',
        status: 'link_invalido',
        statusDetalhe: 'repo privado',
      },
    });

    const devolutiva = await prisma.devolutiva.create({
      data: {
        submissaoId: submissao.id,
        textoAgente: 'Não consegui acessar seu repositório.',
        textoFinal: 'Não consegui acessar seu repositório.',
        vereditoFinal: 'inconclusivo',
      },
    });

    expect(devolutiva.correcaoId).toBeNull();
  });

  it('mantém texto_agente e texto_final em colunas distintas desde a primeira migration', async () => {
    const nomes = await colunas('devolutivas');

    expect(nomes).toContain('texto_agente');
    expect(nomes).toContain('texto_final');
  });
});

describe('correcoes (§5)', () => {
  it('deixa fim e duração nulos enquanto está rodando, e guarda os dois quando termina', async () => {
    const submissao = await prisma.submissao.create({
      data: {
        origem: 'manual',
        alunoNome: 'Aluno',
        alunoEmail: 'aluno@example.com',
        projeto: 'GoLang',
        fase: 'Client-Server-API',
        repoUrl: 'https://github.com/aluno/repo',
        status: 'corrigindo',
      },
    });

    const rodando = await prisma.correcao.create({
      data: {
        submissaoId: submissao.id,
        retryN: 1,
        status: 'rodando',
        modelo: 'claude-opus-5',
        transcriptPath: '/jobs/fc-job-1/transcript.jsonl',
      },
    });

    expect(rodando.finishedAt).toBeNull();
    expect(rodando.duracaoS).toBeNull();
    expect(rodando.veredito).toBeNull();
    expect(rodando.dossie).toBeNull();
    expect(rodando.gatilhos).toEqual([]);

    const concluida = await prisma.correcao.update({
      where: { id: rodando.id },
      data: {
        status: 'concluida',
        veredito: 'aprovado',
        finishedAt: new Date(),
        duracaoS: 421,
        gatilhos: ['tamanho_devolutiva'],
        exitCode: 0,
      },
    });

    expect(concluida.duracaoS).toBe(421);
    expect(concluida.gatilhos).toEqual(['tamanho_devolutiva']);
  });
});
