import {
  linhasDoCsv,
  MODOS_AVALIACAO,
  parseLinhaCsv,
  temAspasDesbalanceadas,
  type ModoAvaliacao,
} from '@banca/shared';

// Leitura e validação de `docs/skills-map.csv`, o arquivo que o Pierry preenche à mão (§17.1).
//
// A regra do §13 F1 é falhar alto: o arquivo inteiro é validado ANTES de qualquer escrita, e uma
// recusa aborta o seed sem tocar no banco (D6). Custa uma mensagem de erro; um `skills_map` meio
// carregado custa submissões em `sem_skill` no meio da fila, que é muito mais caro de diagnosticar.
//
// O parser de linha vem de `packages/shared` — o mesmo que `tests/skills-map.test.ts` (F0) usa.

export const COLUNAS_SKILLS_MAP = [
  'projeto',
  'fase',
  'skill_slug',
  'modo_avaliacao',
  'base_repo_url',
  'timeout_s',
] as const;

export const CABECALHO_SKILLS_MAP = COLUNAS_SKILLS_MAP.join(',');

/// `base_repo_url` e `timeout_s` são opcionais por §5; os outros quatro, não.
const OBRIGATORIOS = ['projeto', 'fase', 'skill_slug', 'modo_avaliacao'] as const;

export interface RegistroSkillsMap {
  projeto: string;
  fase: string;
  skillSlug: string;
  modoAvaliacao: ModoAvaliacao;
  baseRepoUrl: string | null;
  timeoutS: number | null;
}

export interface LeituraSkillsMap {
  registros: RegistroSkillsMap[];
  /** Mensagens no formato `linha N: ...`. Vazio significa arquivo aceito. */
  problemas: string[];
}

export function lerSkillsMap(conteudo: string): LeituraSkillsMap {
  const linhas = linhasDoCsv(conteudo);
  const cabecalho = linhas[0] ?? '';

  // Cabeçalho errado invalida a posição de toda coluna: seguir daqui despejaria dezenas de erros
  // derivados de um único problema, e o real ficaria enterrado no meio deles.
  if (cabecalho !== CABECALHO_SKILLS_MAP) {
    return {
      registros: [],
      problemas: [
        `linha 1: cabeçalho esperado "${CABECALHO_SKILLS_MAP}", encontrado "${cabecalho}"`,
      ],
    };
  }

  const problemas: string[] = [];
  const registros: RegistroSkillsMap[] = [];
  const paresVistos = new Map<string, number>();

  linhas.slice(1).forEach((bruta, indice) => {
    const numero = indice + 2;
    const antes = problemas.length;
    const recusar = (motivo: string) => problemas.push(`linha ${numero}: ${motivo}`);

    if (temAspasDesbalanceadas(bruta)) {
      recusar('aspas abertas que não fecham na mesma linha');
      return;
    }

    const campos = parseLinhaCsv(bruta).map((campo) => campo.trim());
    if (campos.length !== COLUNAS_SKILLS_MAP.length) {
      recusar(`${campos.length} colunas, esperadas ${COLUNAS_SKILLS_MAP.length}`);
      return;
    }

    const valor = (coluna: (typeof COLUNAS_SKILLS_MAP)[number]) =>
      campos[COLUNAS_SKILLS_MAP.indexOf(coluna)] ?? '';

    for (const obrigatorio of OBRIGATORIOS) {
      if (valor(obrigatorio) === '') recusar(`campo "${obrigatorio}" vazio`);
    }

    const modo = valor('modo_avaliacao');
    if (modo !== '' && !(MODOS_AVALIACAO as readonly string[]).includes(modo)) {
      recusar(`modo_avaliacao "${modo}" fora de {${MODOS_AVALIACAO.join(', ')}}`);
    }

    const slug = valor('skill_slug');
    if (slug !== '' && !slug.startsWith('corrige-')) {
      recusar(`skill_slug "${slug}" não nomeia uma skill corrige-*`);
    }

    const timeout = valor('timeout_s');
    if (timeout !== '' && !/^[1-9]\d*$/.test(timeout)) {
      recusar(`timeout_s "${timeout}" não é um número inteiro de segundos`);
    }

    const par = JSON.stringify([valor('projeto'), valor('fase')]);
    const anterior = paresVistos.get(par);
    if (anterior !== undefined) {
      recusar(`par (projeto, fase) repetido — já aparece na linha ${anterior}`);
    } else {
      paresVistos.set(par, numero);
    }

    if (problemas.length > antes) return;

    registros.push({
      projeto: valor('projeto'),
      fase: valor('fase'),
      skillSlug: slug,
      modoAvaliacao: modo as ModoAvaliacao,
      baseRepoUrl: valor('base_repo_url') || null,
      timeoutS: timeout === '' ? null : Number(timeout),
    });
  });

  // Arquivo só com cabeçalho não é "nada a fazer": seria um seed que desativa o mapa inteiro.
  if (problemas.length === 0 && registros.length === 0) {
    problemas.push('o arquivo não tem nenhuma linha de dados');
  }

  return { registros, problemas };
}
