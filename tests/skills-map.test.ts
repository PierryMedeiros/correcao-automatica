import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// O CSV é preenchido à mão (plan §17.1) e vira o skills_map no seed da F1. Um erro de
// digitação aqui não explode: vira submissão em `sem_skill` no meio da fila, que é caro
// de diagnosticar. Estas asserções são a rede antes do seed existir.

const COLUNAS = [
  'projeto',
  'fase',
  'skill_slug',
  'modo_avaliacao',
  'base_repo_url',
  'timeout_s',
] as const;

const MODOS_VALIDOS = ['execucao', 'estatica'];

const caminho = fileURLToPath(new URL('../docs/skills-map.csv', import.meta.url));
const linhas = readFileSync(caminho, 'utf8').trimEnd().split('\n');
const cabecalho = linhas[0] ?? '';
const registros = linhas.slice(1).map((linha, indice) => ({
  numero: indice + 2,
  campos: linha.split(','),
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
        return modo !== '' && !MODOS_VALIDOS.includes(modo);
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
