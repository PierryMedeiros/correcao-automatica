import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ARQUIVO_CLONE,
  ARQUIVO_DOSSIE,
  ARQUIVO_LOG,
  ARQUIVO_RESULTADO,
  ARQUIVO_TRANSCRIPT,
} from './job-dir.js';

// Como o host descobre que o job acabou e o que ele leva de lá (plan §8, §9.2 passo 6, §10.9).
//
// O sinal de fim é o `resultado.json`, não a saída do container: o runner permanece vivo de
// propósito (§8, v1.5) para o retry corretivo do §7 ter onde acontecer. `docker wait` aqui
// esperaria para sempre.
//
// Tudo neste módulo é leitura de arquivo e função pura — quem mata, persiste e derruba é o Job
// Controller. A separação existe para que o desfecho de um job dir montado à mão possa ser testado
// sem Docker nenhum.

/** Escrito pelo entrypoint, sempre de forma atômica (`.parcial` + `mv`). */
export interface MarcadorDeFim {
  exit_code: number;
  finished_at: string;
  motivo: string;
}

/** Escrito pelo entrypoint em todo caminho de clone (D7). Origem do §10.17 e do §10.18. */
export interface InfoDoClone {
  shallow: boolean;
  motivo: string | null;
  submodules: { ok: boolean; erro: string | null };
}

/** A F2 não valida contra schema (D5) — só distingue os três desfechos que a F3 vai precisar. */
export type EstadoDoDossie = 'ausente' | 'invalido' | 'valido';

export interface ArtefatosDoJob {
  jobDir: string;
  temLog: boolean;
  logPath: string;
  transcriptPath: string;
  clone: InfoDoClone | null;
  marcador: MarcadorDeFim | null;
  dossie: { estado: EstadoDoDossie; conteudo: unknown };
}

/**
 * Os códigos do `runner/entrypoint.sh`, traduzidos para o `correcoes.erro_resumo`.
 *
 * A tabela é a segunda cópia dos números — a primeira está no shell. Vive aqui, e não num arquivo
 * compartilhado, porque não existe forma de o shell importar TypeScript: o que mantém as duas
 * honestas é o teste de integração do entrypoint, que provoca cada um dos códigos.
 */
export const CODIGOS_DO_RUNNER: Readonly<Record<number, string>> = {
  64: 'job.json ausente ou inválido dentro do runner',
  65: 'clone do repositório falhou nas duas tentativas (§10.17)',
  66: 'commit_sha pinado não existe no repositório clonado',
  67: 'FC_PAYLOAD_CMD ausente: o runner subiu sem carga para executar',
  70: 'erro inesperado do entrypoint do runner',
};

function lerJson(caminho: string): unknown {
  if (!existsSync(caminho)) return undefined;
  try {
    return JSON.parse(readFileSync(caminho, 'utf8'));
  } catch {
    return null;
  }
}

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/**
 * Lê o marcador, devolvendo `null` enquanto ele não for um marcador completo.
 *
 * O entrypoint escreve com `mv` justamente para o host nunca ver meio arquivo, mas a checagem de
 * forma continua aqui: um `resultado.json` escrito por outra coisa (ou truncado por disco cheio)
 * não pode ser lido como "o job terminou com sucesso".
 */
export function lerMarcador(jobDir: string): MarcadorDeFim | null {
  const bruto = lerJson(join(jobDir, ARQUIVO_RESULTADO));
  if (!ehObjeto(bruto)) return null;

  const { exit_code, finished_at, motivo } = bruto;
  if (
    typeof exit_code !== 'number' ||
    typeof finished_at !== 'string' ||
    typeof motivo !== 'string'
  )
    return null;

  return { exit_code, finished_at, motivo };
}

export function lerCloneInfo(jobDir: string): InfoDoClone | null {
  const bruto = lerJson(join(jobDir, ARQUIVO_CLONE));
  if (!ehObjeto(bruto) || typeof bruto['shallow'] !== 'boolean') return null;

  const submodules = ehObjeto(bruto['submodules']) ? bruto['submodules'] : {};

  return {
    shallow: bruto['shallow'],
    motivo: typeof bruto['motivo'] === 'string' ? bruto['motivo'] : null,
    submodules: {
      ok: submodules['ok'] !== false,
      erro: typeof submodules['erro'] === 'string' ? submodules['erro'] : null,
    },
  };
}

export interface EsperaDoMarcador {
  jobDir: string;
  limiteMs: number;
  intervaloMs?: number;
  /** Relógio e sono injetáveis: o teste do timeout não pode custar o timeout de verdade. */
  agora?: () => number;
  esperar?: (ms: number) => Promise<void>;
}

const INTERVALO_PADRAO_MS = 250;

/** Devolve o marcador, ou `null` quando o limite estourou sem ele — que é o §10.9 acontecendo. */
export async function aguardarMarcador(opcoes: EsperaDoMarcador): Promise<MarcadorDeFim | null> {
  const intervaloMs = opcoes.intervaloMs ?? INTERVALO_PADRAO_MS;
  const agora = opcoes.agora ?? Date.now;
  const esperar = opcoes.esperar ?? ((ms: number) => new Promise((ok) => setTimeout(ok, ms)));
  const limite = agora() + opcoes.limiteMs;

  while (agora() < limite) {
    const marcador = lerMarcador(opcoes.jobDir);
    if (marcador) return marcador;
    await esperar(Math.min(intervaloMs, Math.max(1, limite - agora())));
  }

  // Uma última leitura: o marcador pode ter aparecido exatamente na borda, e desistir dele aqui
  // marcaria como `timeout` um job que terminou dentro do limite.
  return lerMarcador(opcoes.jobDir);
}

export function coletarArtefatos(jobDir: string): ArtefatosDoJob {
  const bruto = lerJson(join(jobDir, ARQUIVO_DOSSIE));
  const estado: EstadoDoDossie =
    bruto === undefined ? 'ausente' : bruto === null ? 'invalido' : 'valido';

  return {
    jobDir,
    temLog: existsSync(join(jobDir, ARQUIVO_LOG)),
    logPath: join(jobDir, ARQUIVO_LOG),
    transcriptPath: join(jobDir, ARQUIVO_TRANSCRIPT),
    clone: lerCloneInfo(jobDir),
    marcador: lerMarcador(jobDir),
    dossie: { estado, conteudo: estado === 'valido' ? bruto : null },
  };
}

/**
 * Traduz o marcador para o par (status da correção, `erro_resumo`) do §5.
 *
 * Exit code != 0 é `falhou`, não `timeout`: quem estourou o relógio nem chega aqui, porque não tem
 * marcador nenhum para traduzir.
 */
export function desfechoDoMarcador(marcador: MarcadorDeFim): {
  status: 'concluida' | 'falhou';
  erroResumo: string | null;
} {
  if (marcador.exit_code === 0) return { status: 'concluida', erroResumo: null };

  const conhecido = CODIGOS_DO_RUNNER[marcador.exit_code];
  const detalhe = conhecido ?? `carga terminou com código ${marcador.exit_code}`;

  return { status: 'falhou', erroResumo: `${detalhe} (motivo: ${marcador.motivo})` };
}

/**
 * As duas medidas são diferentes de propósito, e o texto precisa dizer isso.
 *
 * O limite do §10.9 é contado a partir do start do runner: o jitter de 5–15s do §8 é espera de
 * fila, não trabalho do job, e descontá-lo do orçamento faria um `timeout_s` curto ser consumido
 * antes de o container existir. `duracao_s` é medida do `started_at` da correção — ela responde
 * "quanto essa correção custou", e por isso é sempre maior. Sem essa frase, o `erro_resumo` parece
 * dizer que a espera passou do limite sem ninguém agir.
 */
export function resumoDeTimeout(duracaoS: number, limiteS: number): string {
  return (
    `timeout: o job não escreveu ${ARQUIVO_RESULTADO} dentro do limite efetivo de ${limiteS}s ` +
    `(§10.9), contados do start do runner. A correção durou ${duracaoS}s no total, incluindo o ` +
    'jitter de start. O runner foi morto e o job dir preservado.'
  );
}
