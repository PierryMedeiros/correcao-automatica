import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { lerSkillsMap } from '../../prisma/seed/csv.js';
import { semearSkillsMap } from '../../prisma/seed/skills-map.js';
import { databaseUrlTest } from '../../src/env.js';
import { prismaTeste } from '../setup-db.js';

const prisma = prismaTeste();
const executar = promisify(execFile);

function fixture(nome: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${nome}`, import.meta.url)), 'utf8');
}

function caminhoFixture(nome: string): string {
  return fileURLToPath(new URL(`../fixtures/${nome}`, import.meta.url));
}

async function carregar(nome: string) {
  const { registros, problemas } = lerSkillsMap(fixture(nome));
  expect(problemas).toEqual([]);
  return semearSkillsMap(prisma, registros);
}

describe('leitura do CSV: o arquivo é recusado inteiro antes de qualquer escrita (D6)', () => {
  it('aceita o arquivo bom e devolve uma linha por registro', () => {
    const { registros, problemas } = lerSkillsMap(fixture('skills-map-valido.csv'));

    expect(problemas).toEqual([]);
    expect(registros).toHaveLength(4);
  });

  it('aponta linha e campo quando falta a fase — é o que o operador precisa para corrigir', () => {
    const { problemas } = lerSkillsMap(fixture('skills-map-sem-fase-na-linha-7.csv'));

    expect(problemas).toEqual(['linha 7: campo "fase" vazio']);
  });

  it('recusa linha com número de colunas diferente de seis', () => {
    const { problemas } = lerSkillsMap(fixture('skills-map-colunas-de-menos.csv'));

    expect(problemas).toEqual(['linha 3: 5 colunas, esperadas 6']);
  });

  it('recusa modo_avaliacao fora do enum do §5', () => {
    const { problemas } = lerSkillsMap(fixture('skills-map-modo-invalido.csv'));

    expect(problemas).toEqual(['linha 2: modo_avaliacao "leitura" fora de {execucao, estatica}']);
  });

  it('recusa o arquivo inteiro quando o cabeçalho não é o esperado', () => {
    const { registros, problemas } = lerSkillsMap(fixture('skills-map-cabecalho-errado.csv'));

    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain('linha 1: cabeçalho esperado');
    expect(registros).toEqual([]);
  });

  it('recusa aspas que abrem e não fecham, em vez de engolir o resto da linha', () => {
    const { problemas } = lerSkillsMap(fixture('skills-map-aspas-desbalanceadas.csv'));

    expect(problemas).toEqual(['linha 3: aspas abertas que não fecham na mesma linha']);
  });

  it('recusa skill_slug que não nomeia uma skill corrige-*', () => {
    const { problemas } = lerSkillsMap(
      'projeto,fase,skill_slug,modo_avaliacao,base_repo_url,timeout_s\nP,F,revisa-x,execucao,,\n',
    );

    expect(problemas).toEqual(['linha 2: skill_slug "revisa-x" não nomeia uma skill corrige-*']);
  });

  it('recusa timeout_s que não é número inteiro de segundos', () => {
    const { problemas } = lerSkillsMap(
      'projeto,fase,skill_slug,modo_avaliacao,base_repo_url,timeout_s\nP,F,corrige-x,execucao,,25min\n',
    );

    expect(problemas).toEqual(['linha 2: timeout_s "25min" não é um número inteiro de segundos']);
  });

  // O par é a chave do upsert: repetido, a segunda linha sobrescreveria a primeira em silêncio.
  it('recusa o mesmo par (projeto, fase) duas vezes, dizendo onde ele já apareceu', () => {
    const { problemas } = lerSkillsMap(
      'projeto,fase,skill_slug,modo_avaliacao,base_repo_url,timeout_s\n' +
        'P,F,corrige-x,execucao,,\nP,F,corrige-y,estatica,,\n',
    );

    expect(problemas).toEqual(['linha 3: par (projeto, fase) repetido — já aparece na linha 2']);
  });

  it('lista todos os problemas de uma vez, não um por execução', () => {
    const { problemas } = lerSkillsMap(
      'projeto,fase,skill_slug,modo_avaliacao,base_repo_url,timeout_s\n' +
        'P1,,corrige-x,execucao,,\nP2,F2,corrige-y,leitura,,\n',
    );

    expect(problemas).toHaveLength(2);
  });

  it('recusa arquivo só com cabeçalho — seria um seed que desativa o mapa inteiro', () => {
    const { problemas } = lerSkillsMap(
      'projeto,fase,skill_slug,modo_avaliacao,base_repo_url,timeout_s\n',
    );

    expect(problemas).toEqual(['o arquivo não tem nenhuma linha de dados']);
  });

  // O CSV é editado à mão, possivelmente no Excel: BOM no começo e CRLF no fim de cada linha.
  it('sobrevive a BOM e CRLF sem recusar o arquivo', () => {
    const { registros, problemas } = lerSkillsMap(
      '\uFEFFprojeto,fase,skill_slug,modo_avaliacao,base_repo_url,timeout_s\r\nP,F,corrige-x,execucao,,\r\n',
    );

    expect(problemas).toEqual([]);
    expect(registros).toHaveLength(1);
  });
});

describe('carga do skills_map (§5, §17.1)', () => {
  it('grava cada linha com os campos opcionais no lugar certo', async () => {
    await carregar('skills-map-valido.csv');

    const linhas = await prisma.skillsMap.findMany({ orderBy: { skillSlug: 'asc' } });

    expect(linhas).toHaveLength(4);
    expect(linhas.map((l) => l.skillSlug)).toEqual([
      'corrige-client-server-api',
      'corrige-compose-cluster',
      'corrige-multithreading',
      'corrige-observabilidade',
    ]);
    expect(linhas.find((l) => l.skillSlug === 'corrige-multithreading')?.timeoutS).toBe(1800);
    expect(linhas.find((l) => l.skillSlug === 'corrige-client-server-api')?.baseRepoUrl).toBe(
      'https://github.com/fc/base-cs-api',
    );
    expect(linhas.every((l) => l.ativo)).toBe(true);
  });

  // Sem RFC 4180 o nome do desafio chegaria partido, e o casamento com o bloco colado é literal:
  // o par simplesmente nunca casaria, e a submissão viraria `sem_skill` sem explicação.
  it('preserva a vírgula que está dentro do nome do desafio', async () => {
    await carregar('skills-map-valido.csv');

    const comVirgula = await prisma.skillsMap.findFirst({
      where: { skillSlug: 'corrige-compose-cluster' },
    });

    expect(comVirgula?.fase).toBe('Do compose ao cluster: Docker, Kubernetes e Terraform');
  });

  it('rodar duas vezes não duplica nem desativa nada', async () => {
    const primeira = await carregar('skills-map-valido.csv');
    const segunda = await carregar('skills-map-valido.csv');

    expect(primeira).toEqual({ inseridas: 4, atualizadas: 0, desativadas: 0 });
    expect(segunda).toEqual({ inseridas: 0, atualizadas: 4, desativadas: 0 });
    expect(await prisma.skillsMap.count()).toBe(4);
    expect(await prisma.skillsMap.count({ where: { ativo: true } })).toBe(4);
  });

  it('atualiza o que mudou no CSV sem criar linha nova', async () => {
    await carregar('skills-map-valido.csv');
    const { registros } = lerSkillsMap(fixture('skills-map-valido.csv').replace(',1800', ',2400'));

    await semearSkillsMap(prisma, registros);

    const linha = await prisma.skillsMap.findFirst({
      where: { skillSlug: 'corrige-multithreading' },
    });
    expect(linha?.timeoutS).toBe(2400);
    expect(await prisma.skillsMap.count()).toBe(4);
  });

  // Deletar quebraria a FK de submissões antigas, que apontam para o desafio pelo par (D7).
  it('desativa o que sumiu do CSV, sem deletar', async () => {
    await carregar('skills-map-valido.csv');

    const sumario = await carregar('skills-map-reduzido.csv');

    expect(sumario.desativadas).toBe(2);
    expect(await prisma.skillsMap.count()).toBe(4);
    expect(
      (await prisma.skillsMap.findMany({ where: { ativo: false } })).map((l) => l.skillSlug).sort(),
    ).toEqual(['corrige-compose-cluster', 'corrige-observabilidade']);
  });

  it('reativa o par que volta ao CSV — o arquivo é a fonte da verdade do mapa', async () => {
    await carregar('skills-map-valido.csv');
    await carregar('skills-map-reduzido.csv');

    await carregar('skills-map-valido.csv');

    expect(await prisma.skillsMap.count({ where: { ativo: true } })).toBe(4);
  });
});

describe('pnpm db:seed de ponta a ponta', () => {
  const seed = (csv: string) =>
    executar('./node_modules/.bin/tsx', ['prisma/seed/index.ts', caminhoFixture(csv)], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      env: { ...process.env, DATABASE_URL: databaseUrlTest() },
    });

  it('carrega o CSV bom e semeia config na mesma execução', async () => {
    const { stdout } = await seed('skills-map-valido.csv');

    expect(stdout).toContain('4 inserida(s)');
    expect(await prisma.skillsMap.count()).toBe(4);
    expect(await prisma.config.count()).toBeGreaterThan(0);
  });

  // "Falhar alto aqui é barato" (§13 F1): melhor recusar tudo do que carregar metade.
  it('recusa o CSV mutilado com código ≠ 0 e não escreve nada — nem skills_map, nem config', async () => {
    await expect(seed('skills-map-sem-fase-na-linha-7.csv')).rejects.toMatchObject({ code: 1 });

    expect(await prisma.skillsMap.count()).toBe(0);
    expect(await prisma.config.count()).toBe(0);
  });

  it('diz qual linha e qual campo recusaram o arquivo', async () => {
    const erro = await seed('skills-map-sem-fase-na-linha-7.csv').catch((e: Error) => e);

    expect(String((erro as { stderr?: string }).stderr)).toContain('linha 7: campo "fase" vazio');
  });
});
