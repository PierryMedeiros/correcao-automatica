import { describe, expect, it } from 'vitest';
import { prismaTeste } from '../setup-db.js';

const prisma = prismaTeste();

function par(projeto: string, fase: string) {
  return {
    projeto,
    fase,
    skillSlug: `corrige-${fase.toLowerCase()}`,
    modoAvaliacao: 'execucao' as const,
  };
}

describe('skills_map (plan §5)', () => {
  it('recusa o mesmo par (projeto, fase) duas vezes — é o lookup do intake', async () => {
    await prisma.skillsMap.create({ data: par('GoLang', 'Client-Server-API') });

    await expect(
      prisma.skillsMap.create({
        data: { ...par('GoLang', 'Client-Server-API'), skillSlug: 'corrige-outra' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('aceita o mesmo projeto em fases diferentes', async () => {
    await prisma.skillsMap.create({ data: par('GoLang', 'Client-Server-API') });
    await prisma.skillsMap.create({ data: par('GoLang', 'Multithreading') });

    expect(await prisma.skillsMap.count({ where: { projeto: 'GoLang' } })).toBe(2);
  });

  it('nasce ativo — desativar é ação explícita do seed, não o contrário (D7)', async () => {
    const linha = await prisma.skillsMap.create({ data: par('GoLang', 'Rate-Limiter') });

    expect(linha.ativo).toBe(true);
  });

  it('deixa base_repo_url e timeout_s nulos: os dois são opcionais no §5', async () => {
    const linha = await prisma.skillsMap.create({ data: par('MBA', 'Terraform') });

    expect(linha.baseRepoUrl).toBeNull();
    expect(linha.timeoutS).toBeNull();
  });

  it('guarda o override de timeout quando ele existe (§10.9)', async () => {
    const linha = await prisma.skillsMap.create({
      data: { ...par('MBA', 'Kubernetes'), timeoutS: 2400, baseRepoUrl: 'https://x/base' },
    });

    expect(linha.timeoutS).toBe(2400);
    expect(linha.baseRepoUrl).toBe('https://x/base');
  });
});
