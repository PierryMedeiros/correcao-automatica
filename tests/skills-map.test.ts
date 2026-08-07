import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { linhasDoCsv, MODOS_AVALIACAO, parseLinhaCsv, temAspasDesbalanceadas } from '@banca/shared';
import { describe, expect, it } from 'vitest';

// O CSV é preenchido à mão (plan §17.1) e vira o skills_map no seed da F1. Um erro de
// digitação aqui não explode: vira submissão em `sem_skill` no meio da fila, que é caro
// de diagnosticar. Estas asserções são a rede antes do seed existir — e continuam valendo
// depois dele: o seed respeita este contrato, não o substitui.
//
// O parser é o de `packages/shared` — o mesmo que o seed usa. Duas implementações seriam duas
// definições do que é o arquivo, e a divergência apareceria só como par que não casa na fila.

const COLUNAS = [
  'projeto',
  'fase',
  'skill_slug',
  'modo_avaliacao',
  'base_repo_url',
  'timeout_s',
] as const;

const caminho = fileURLToPath(new URL('../docs/skills-map.csv', import.meta.url));
const linhas = linhasDoCsv(readFileSync(caminho, 'utf8'));
const cabecalho = linhas[0] ?? '';
const registros = linhas.slice(1).map((linha, indice) => ({
  numero: indice + 2,
  bruta: linha,
  campos: parseLinhaCsv(linha),
}));

function campo(campos: string[], nome: (typeof COLUNAS)[number]): string {
  return campos[COLUNAS.indexOf(nome)]?.trim() ?? '';
}

describe('docs/skills-map.csv', () => {
  it('tem o cabeçalho na ordem que o seed espera', () => {
    expect(cabecalho).toBe(COLUNAS.join(','));
  });

  it('não está vazio', () => {
    expect(registros.length).toBeGreaterThan(0);
  });

  it('não deixa aspas abertas — valor com vírgula tem que fechar as aspas na mesma linha', () => {
    const fora = registros
      .filter((r) => temAspasDesbalanceadas(r.bruta))
      .map((r) => `linha ${r.numero}: ${r.bruta}`);
    expect(fora).toEqual([]);
  });

  it('toda linha tem exatamente as seis colunas', () => {
    const fora = registros
      .filter((r) => r.campos.length !== COLUNAS.length)
      .map((r) => `linha ${r.numero}: ${r.campos.length} colunas`);
    expect(fora).toEqual([]);
  });

  it('todo skill_slug é preenchido e nomeia uma skill corrige-*', () => {
    const fora = registros
      .filter((r) => !campo(r.campos, 'skill_slug').startsWith('corrige-'))
      .map((r) => `linha ${r.numero}: "${campo(r.campos, 'skill_slug')}"`);
    expect(fora).toEqual([]);
  });

  it('não repete skill_slug', () => {
    const vistos = new Set<string>();
    const repetidos = registros
      .filter((r) => {
        const slug = campo(r.campos, 'skill_slug');
        if (vistos.has(slug)) return true;
        vistos.add(slug);
        return false;
      })
      .map((r) => `linha ${r.numero}: ${campo(r.campos, 'skill_slug')}`);
    expect(repetidos).toEqual([]);
  });

  it('aceita modo_avaliacao vazio, mas rejeita valor fora do enum do plan §5', () => {
    const fora = registros
      .filter((r) => {
        const modo = campo(r.campos, 'modo_avaliacao');
        return modo !== '' && !(MODOS_AVALIACAO as readonly string[]).includes(modo);
      })
      .map((r) => `linha ${r.numero}: "${campo(r.campos, 'modo_avaliacao')}"`);
    expect(fora).toEqual([]);
  });

  it('não repete o par (projeto, fase) — é UNIQUE no skills_map (plan §5)', () => {
    const vistos = new Set<string>();
    const repetidos = registros
      .filter((r) => {
        const projeto = campo(r.campos, 'projeto');
        const fase = campo(r.campos, 'fase');
        if (projeto === '' || fase === '') return false;
        const chave = JSON.stringify([projeto, fase]);
        if (vistos.has(chave)) return true;
        vistos.add(chave);
        return false;
      })
      .map((r) => `linha ${r.numero}: ${campo(r.campos, 'projeto')} / ${campo(r.campos, 'fase')}`);
    expect(repetidos).toEqual([]);
  });
});
