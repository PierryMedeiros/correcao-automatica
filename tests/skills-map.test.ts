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

// Nome de desafio na plataforma pode conter vírgula ("Do compose ao cluster: Docker, Kubernetes e
// Terraform"), e o casamento com o bloco colado é literal — trocar a vírgula por outro caractere
// garantiria que o par nunca casa. Por isso o arquivo segue o RFC 4180: valor com vírgula vai entre
// aspas, e aspas dentro do valor são dobradas. Um `split(',')` ingênuo quebraria essas linhas.
function parseLinha(linha: string): string[] {
  const campos: string[] = [];
  let atual = '';
  let dentroDeAspas = false;

  for (let i = 0; i < linha.length; i++) {
    const caractere = linha[i];
    if (dentroDeAspas) {
      if (caractere === '"' && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else if (caractere === '"') {
        dentroDeAspas = false;
      } else {
        atual += caractere;
      }
    } else if (caractere === '"') {
      dentroDeAspas = true;
    } else if (caractere === ',') {
      campos.push(atual);
      atual = '';
    } else {
      atual += caractere;
    }
  }

  campos.push(atual);
  return campos;
}

function temAspasDesbalanceadas(linha: string): boolean {
  return (linha.match(/"/g)?.length ?? 0) % 2 !== 0;
}

const caminho = fileURLToPath(new URL('../docs/skills-map.csv', import.meta.url));
const linhas = readFileSync(caminho, 'utf8').trimEnd().split('\n');
const cabecalho = linhas[0] ?? '';
const registros = linhas.slice(1).map((linha, indice) => ({
  numero: indice + 2,
  bruta: linha,
  campos: parseLinha(linha),
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

describe('parser de linha do CSV (RFC 4180)', () => {
  it('separa campos simples', () => {
    expect(parseLinha('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('preserva a vírgula que está dentro de aspas', () => {
    expect(parseLinha('MBA,"Docker, Kubernetes e Terraform",corrige-x')).toEqual([
      'MBA',
      'Docker, Kubernetes e Terraform',
      'corrige-x',
    ]);
  });

  it('desdobra aspas duplicadas dentro do valor', () => {
    expect(parseLinha('a,"diz ""oi"" aqui",c')).toEqual(['a', 'diz "oi" aqui', 'c']);
  });

  it('mantém campos vazios', () => {
    expect(parseLinha('a,,c,')).toEqual(['a', '', 'c', '']);
  });
});
