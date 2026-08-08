import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  aguardarMarcador,
  coletarArtefatos,
  desfechoDoMarcador,
  lerMarcador,
  resumoDeTimeout,
} from './coleta.js';
import { ARQUIVO_CLONE, ARQUIVO_DOSSIE, ARQUIVO_LOG, ARQUIVO_RESULTADO } from './job-dir.js';

// O que este arquivo trava é o sinal de fim do job. Ler um marcador pela metade como se fosse o
// desfecho faz o host colher artefato que ainda está sendo escrito e derrubar o runner no meio da
// correção — sem erro nenhum, com a correção marcada `concluida`.

let jobDir: string;

function escrever(arquivo: string, conteudo: string): void {
  writeFileSync(join(jobDir, arquivo), conteudo, 'utf8');
}

beforeEach(() => {
  jobDir = mkdtempSync(join(tmpdir(), 'banca-coleta-'));
});

afterEach(() => {
  rmSync(jobDir, { recursive: true, force: true });
});

describe('marcador de fim', () => {
  it('não existe enquanto o job não terminou', () => {
    expect(lerMarcador(jobDir)).toBeNull();
  });

  it('escrito pela metade não é lido como fim', () => {
    escrever(ARQUIVO_RESULTADO, '{"exit_code": 0, "finished_at": "2026-08-07T1');
    expect(lerMarcador(jobDir)).toBeNull();
  });

  it('JSON completo mas sem os campos do contrato não é lido como fim', () => {
    escrever(ARQUIVO_RESULTADO, '{"exit_code": 0}');
    expect(lerMarcador(jobDir)).toBeNull();
  });

  it('completo devolve exit code, horário e motivo', () => {
    escrever(
      ARQUIVO_RESULTADO,
      '{"exit_code": 3, "finished_at": "2026-08-07T12:00:00Z", "motivo": "carga_concluida"}',
    );
    expect(lerMarcador(jobDir)).toEqual({
      exit_code: 3,
      finished_at: '2026-08-07T12:00:00Z',
      motivo: 'carga_concluida',
    });
  });
});

describe('espera pelo marcador', () => {
  it('devolve o marcador assim que ele aparece, sem esperar o limite inteiro', async () => {
    let relogio = 0;
    let ciclos = 0;

    const marcador = await aguardarMarcador({
      jobDir,
      limiteMs: 10_000,
      intervaloMs: 100,
      agora: () => relogio,
      esperar: async (ms) => {
        relogio += ms;
        if (++ciclos === 3) {
          escrever(
            ARQUIVO_RESULTADO,
            '{"exit_code": 0, "finished_at": "2026-08-07T12:00:00Z", "motivo": "carga_concluida"}',
          );
        }
      },
    });

    expect(marcador?.exit_code).toBe(0);
    expect(relogio).toBeLessThan(10_000);
  });

  it('devolve null quando o limite estoura sem marcador — é o §10.9 acontecendo', async () => {
    let relogio = 0;

    const marcador = await aguardarMarcador({
      jobDir,
      limiteMs: 1_000,
      intervaloMs: 250,
      agora: () => relogio,
      esperar: async (ms) => {
        relogio += ms;
      },
    });

    expect(marcador).toBeNull();
    expect(relogio).toBeGreaterThanOrEqual(1_000);
  });

  it('marcador que aparece na borda do limite ainda vale', async () => {
    let relogio = 0;

    const marcador = await aguardarMarcador({
      jobDir,
      limiteMs: 500,
      intervaloMs: 500,
      agora: () => relogio,
      esperar: async (ms) => {
        relogio += ms;
        escrever(
          ARQUIVO_RESULTADO,
          '{"exit_code": 0, "finished_at": "2026-08-07T12:00:00Z", "motivo": "carga_concluida"}',
        );
      },
    });

    // Sem a releitura final, este job terminado viraria `timeout` e o runner morreria à toa.
    expect(marcador).not.toBeNull();
  });
});

describe('coleta de artefatos', () => {
  it('distingue dossiê ausente, inválido e válido', () => {
    expect(coletarArtefatos(jobDir).dossie).toEqual({ estado: 'ausente', conteudo: null });

    escrever(ARQUIVO_DOSSIE, '{"veredito": "aprov');
    expect(coletarArtefatos(jobDir).dossie).toEqual({ estado: 'invalido', conteudo: null });

    escrever(ARQUIVO_DOSSIE, '{"veredito": "aprovado"}');
    const valido = coletarArtefatos(jobDir).dossie;
    expect(valido.estado).toBe('valido');
    expect(valido.conteudo).toEqual({ veredito: 'aprovado' });
  });

  it('lê o clone.json com o fallback shallow e o submodule quebrado (§10.17, §10.18)', () => {
    escrever(
      ARQUIVO_CLONE,
      '{"shallow": true, "motivo": "timeout_120s", "submodules": {"ok": false, "erro": "repo sumiu"}}',
    );

    expect(coletarArtefatos(jobDir).clone).toEqual({
      shallow: true,
      motivo: 'timeout_120s',
      submodules: { ok: false, erro: 'repo sumiu' },
    });
  });

  it('registra a presença do log e o caminho canônico do transcript', () => {
    expect(coletarArtefatos(jobDir).temLog).toBe(false);

    escrever(ARQUIVO_LOG, 'linha de log\n');
    const artefatos = coletarArtefatos(jobDir);

    expect(artefatos.temLog).toBe(true);
    expect(artefatos.transcriptPath).toBe(join(jobDir, 'transcript.jsonl'));
  });
});

describe('tradução do desfecho', () => {
  it('exit code 0 fecha a correção como concluída', () => {
    expect(
      desfechoDoMarcador({ exit_code: 0, finished_at: 'x', motivo: 'carga_concluida' }),
    ).toEqual({ status: 'concluida', erroResumo: null });
  });

  it('código do runner vira erro_resumo legível, sem ninguém parsear log', () => {
    const { status, erroResumo } = desfechoDoMarcador({
      exit_code: 65,
      finished_at: 'x',
      motivo: 'clone_falhou',
    });

    expect(status).toBe('falhou');
    expect(erroResumo).toContain('clone do repositório falhou');
    expect(erroResumo).toContain('clone_falhou');
  });

  it('código da carga (fora da faixa do runner) aparece como número', () => {
    const { status, erroResumo } = desfechoDoMarcador({
      exit_code: 23,
      finished_at: 'x',
      motivo: 'carga_concluida',
    });

    expect(status).toBe('falhou');
    expect(erroResumo).toContain('código 23');
  });

  it('o resumo do timeout diz a duração e o limite aplicado', () => {
    const resumo = resumoDeTimeout(63, 60);
    expect(resumo).toContain('63s');
    expect(resumo).toContain('60s');
  });
});
