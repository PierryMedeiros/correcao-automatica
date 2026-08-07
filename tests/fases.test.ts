import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// O estado de cada fase aparece em três lugares — o arquivo da fase, o índice e o §13 do plano —
// e o CLAUDE.md avisa que duas versões da mesma verdade fazem o agente escolher sozinho qual
// obedecer. Aqui a escolha deixa de existir: divergência quebra o build. Este é o guard que a
// skill `implementar-fase` manda rodar no encerramento de toda fase.

const SECOES_OBRIGATORIAS = [
  '## Objetivo',
  '## Pré-condições',
  '## Decisões do plano que esta fase materializa',
  '## Decisões a tomar nesta fase',
  '## Etapas',
  '## Edge cases do §10 cobertos aqui',
  '## Critérios de aceite',
  '## Testes que nascem nesta fase',
  '## Riscos e armadilhas',
  '## O que NÃO entra nesta fase',
  '## Impacto em fases seguintes',
  '## Registro de execução',
] as const;

const MARCADOR = /(⬜|⏳|✅)/;

// Fase implementada carrega a conclusão no próprio nome do arquivo: quem der um `ls` em
// docs/fases/ vê o que já está pronto sem abrir nada. A correspondência é "se e só se" —
// renomear sem fechar a fase mente tanto quanto fechar a fase sem renomear.
const SUFIXO_CONCLUIDA = '-concluida.md';

const dirFases = fileURLToPath(new URL('../docs/fases/', import.meta.url));
const indice = readFileSync(new URL('../docs/fases/README.md', import.meta.url), 'utf8');
const plano = readFileSync(new URL('../docs/project-plan.md', import.meta.url), 'utf8');

interface Fase {
  id: string;
  arquivo: string;
  texto: string;
  estado: string;
  data: string | null;
  dependeDe: string[];
  destrava: string[];
}

function marcadorEData(linha: string): { estado: string; data: string | null } {
  return {
    estado: MARCADOR.exec(linha)?.[1] ?? '',
    data: /(\d{4}-\d{2}-\d{2})/.exec(linha)?.[1] ?? null,
  };
}

function referencias(texto: string, rotulo: string): string[] {
  const linha = new RegExp(`^> \\*\\*${rotulo}:\\*\\*(.*)$`, 'm').exec(texto)?.[1] ?? '';
  return [...new Set(linha.match(/F\d/g) ?? [])].sort();
}

const fases: Fase[] = readdirSync(dirFases)
  .filter((nome) => /^F\d-.+\.md$/.test(nome))
  .sort()
  .map((arquivo) => {
    const texto = readFileSync(`${dirFases}${arquivo}`, 'utf8');
    const status = /^> \*\*Status:\*\*.*$/m.exec(texto)?.[0] ?? '';
    return {
      id: arquivo.slice(0, 2),
      arquivo,
      texto,
      ...marcadorEData(status),
      dependeDe: referencias(texto, 'Depende de'),
      destrava: referencias(texto, 'Destrava'),
    };
  });

const porId = new Map(fases.map((f) => [f.id, f]));

describe('docs/fases — estrutura dos arquivos de fase', () => {
  it('existe um arquivo para cada fase de F0 a F9', () => {
    expect(fases.map((f) => f.id)).toEqual([
      'F0',
      'F1',
      'F2',
      'F3',
      'F4',
      'F5',
      'F6',
      'F7',
      'F8',
      'F9',
    ]);
  });

  it.each(fases)('$id tem todas as seções que a skill implementar-fase espera', (fase) => {
    const faltando = SECOES_OBRIGATORIAS.filter((secao) => !fase.texto.includes(`\n${secao}\n`));
    expect(faltando).toEqual([]);
  });

  it.each(fases)('$id declara um status válido no cabeçalho', (fase) => {
    expect(['⬜', '⏳', '✅']).toContain(fase.estado);
    if (fase.estado !== '⬜') expect(fase.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it.each(fases)('o arquivo de $id só se chama "concluida" quando a fase está', (fase) => {
    expect(fase.arquivo.endsWith(SUFIXO_CONCLUIDA)).toBe(fase.estado === '✅');
  });

  it.each(fases)('$id quebra o objetivo em etapas numeradas', (fase) => {
    const etapas = fase.texto.match(new RegExp(`^### ${fase.id}\\.\\d+ — `, 'gm')) ?? [];
    expect(etapas.length).toBeGreaterThan(0);
  });

  it.each(fases)('$id não deixa tarefa em aberto depois de marcada como implementada', (fase) => {
    if (fase.estado !== '✅') return;
    expect(fase.texto).not.toMatch(/^\s*- \[ \]/m);
  });
});

describe('docs/fases — grafo de dependências', () => {
  it.each(fases)('$id só depende de fases que existem e vêm antes dela', (fase) => {
    const invalidas = fase.dependeDe.filter((id) => !porId.has(id) || id >= fase.id);
    expect(invalidas).toEqual([]);
  });

  it.each(fases)('$id aparece em "Destrava" de cada fase de que depende', (fase) => {
    const assimetricas = fase.dependeDe.filter((id) => !porId.get(id)?.destrava.includes(fase.id));
    expect(assimetricas).toEqual([]);
  });

  it.each(fases)('cada fase que $id destrava declara depender dela', (fase) => {
    const assimetricas = fase.destrava.filter((id) => !porId.get(id)?.dependeDe.includes(fase.id));
    expect(assimetricas).toEqual([]);
  });

  it.each(fases)('$id não está implementada antes das fases de que depende', (fase) => {
    if (fase.estado !== '✅') return;
    const pendentes = fase.dependeDe.filter((id) => porId.get(id)?.estado !== '✅');
    expect(pendentes).toEqual([]);
  });
});

describe('docs/fases/README.md — índice', () => {
  const linhas = new Map(
    [...indice.matchAll(/^\|\s*\[(F\d)[^\]]*\]\(([^)]+)\)\s*\|([^|]*)\|/gm)].map((m) => [
      m[1] ?? '',
      { destino: (m[2] ?? '').trim(), status: (m[3] ?? '').trim() },
    ]),
  );

  it('lista exatamente as dez fases', () => {
    expect([...linhas.keys()].sort()).toEqual(fases.map((f) => f.id));
  });

  it.each(fases)('a linha de $id aponta para o arquivo da fase', (fase) => {
    expect(linhas.get(fase.id)?.destino).toBe(fase.arquivo);
  });

  it.each(fases)('o status de $id no índice bate com o do arquivo da fase', (fase) => {
    const noIndice = marcadorEData(linhas.get(fase.id)?.status ?? '');
    expect(noIndice).toEqual({ estado: fase.estado, data: fase.data });
  });
});

describe('docs/project-plan.md §13 — índice de fases', () => {
  const secoes = new Map(
    plano
      .split(/^### /m)
      .slice(1)
      .filter((bloco) => /^F\d — /.test(bloco))
      .map((bloco) => [bloco.slice(0, 2), bloco]),
  );

  function dependenciasNoPlano(id: string): string[] {
    const linha = /^\*\*Depende de:\*\* (.*)$/m.exec(secoes.get(id) ?? '')?.[1] ?? '';
    return [...new Set(linha.match(/F\d/g) ?? [])].sort();
  }

  it('mantém uma seção para cada fase', () => {
    expect([...secoes.keys()].sort()).toEqual(fases.map((f) => f.id));
  });

  it.each(fases)('o status de $id no §13 bate com o do arquivo da fase', (fase) => {
    const titulo = /^.*$/m.exec(secoes.get(fase.id) ?? '')?.[0] ?? '';
    expect(marcadorEData(titulo)).toEqual({ estado: fase.estado, data: fase.data });
  });

  it.each(fases)('as dependências de $id no §13 batem com as do arquivo da fase', (fase) => {
    expect(dependenciasNoPlano(fase.id)).toEqual(fase.dependeDe);
  });

  it.each(fases)('o §13 aponta para o arquivo de $id', (fase) => {
    expect(secoes.get(fase.id)).toContain(`docs/fases/${fase.arquivo}`);
  });
});
