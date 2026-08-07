import { describe, expect, it } from 'vitest';
import { CONFIG_PADRAO, semearConfig } from '../../prisma/seed/config.js';
import { prismaTeste } from '../setup-db.js';

const prisma = prismaTeste();

async function valorDe(chave: string): Promise<unknown> {
  const linha = await prisma.config.findUnique({ where: { chave } });
  return linha?.valor;
}

describe('defaults de config (§10, §11, §12)', () => {
  it('semeia todas as chaves com os valores do plano', async () => {
    await semearConfig(prisma);

    const linhas = await prisma.config.findMany();
    const porChave = new Map(linhas.map((l) => [l.chave, l.valor]));

    expect([...porChave.keys()].sort()).toEqual(CONFIG_PADRAO.map((p) => p.chave).sort());
    expect(porChave.get('gatilho_tamanho_aprovado_frases')).toBe(5);
    expect(porChave.get('gatilho_tamanho_aprovado_caracteres')).toBe(700);
    expect(porChave.get('gatilho_tamanho_reprovado_frases')).toBe(20);
    expect(porChave.get('gatilho_similaridade_limiar')).toBe(0.6);
    expect(porChave.get('gatilho_duracao_min_amostras')).toBe(10);
    expect(porChave.get('gatilho_duracao_fracao_timeout')).toBe(0.8);
    expect(porChave.get('gatilho_agregacao_min_ocorrencias')).toBe(3);
    expect(porChave.get('disco_alerta_gb')).toBe(15);
    expect(porChave.get('disco_pausa_gb')).toBe(5);
    expect(porChave.get('retencao_job_dir_dias')).toBe(14);
    expect(porChave.get('retencao_backup_dias')).toBe(14);
    expect(porChave.get('retomada_intervalos_min')).toEqual([5, 15, 30, 60]);
  });

  // Booleano não bastaria: a pausa automática precisa dizer por quê e desde quando, senão o
  // operador encontra o sistema parado sem saber se foi limite de plano, credencial ou disco (§12).
  it('grava pausa_global como objeto, nunca como flag', async () => {
    await semearConfig(prisma);

    expect(await valorDe('pausa_global')).toEqual({
      ativa: false,
      motivo: null,
      desde: null,
      tentativas: 0,
    });
  });

  // O timeout efetivo é sempre `skills_map.timeout_s ?? config.timeout_job_padrao_s`, e este é o
  // único lugar do sistema onde o número 1500 aparece (§5, §10.9).
  it('grava timeout_job_padrao_s = 1500', async () => {
    await semearConfig(prisma);

    expect(await valorDe('timeout_job_padrao_s')).toBe(1500);
  });

  it('deixa a devolutiva de link inválido com marcador para o motivo (§6, §10.1–2)', async () => {
    await semearConfig(prisma);

    expect(await valorDe('devolutiva_link_invalido_template')).toContain('{{motivo}}');
  });

  it('explica de qual seção do plano cada default veio', async () => {
    await semearConfig(prisma);

    const semDescricao = await prisma.config.findMany({ where: { descricao: '' } });
    expect(semDescricao).toEqual([]);
  });

  // Valor calibrado na operação (F7) não pode ser revertido por alguém rodando `pnpm db:seed`.
  it('não sobrescreve valor já calibrado ao rodar de novo', async () => {
    await semearConfig(prisma);
    await prisma.config.update({
      where: { chave: 'gatilho_similaridade_limiar' },
      data: { valor: 0.85 },
    });

    const { criadas } = await semearConfig(prisma);

    expect(criadas).toBe(0);
    expect(await valorDe('gatilho_similaridade_limiar')).toBe(0.85);
  });

  it('completa chave que falta sem tocar nas que já existem', async () => {
    await semearConfig(prisma);
    await prisma.config.delete({ where: { chave: 'disco_pausa_gb' } });

    const { criadas } = await semearConfig(prisma);

    expect(criadas).toBe(1);
    expect(await valorDe('disco_pausa_gb')).toBe(5);
  });
});

describe('pg_trgm (§10.24, §12)', () => {
  it('está instalada por migration, não por comando solto no banco', async () => {
    const extensoes = await prisma.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'
    `;

    expect(extensoes).toHaveLength(1);
  });

  it('responde similarity, que é o que o gatilho de devolutiva repetida vai chamar', async () => {
    const [linha] = await prisma.$queryRaw<{ similaridade: number }[]>`
      SELECT similarity('abc', 'abd') AS similaridade
    `;

    expect(linha?.similaridade).toBeGreaterThan(0);
    expect(linha?.similaridade).toBeLessThan(1);
  });
});
