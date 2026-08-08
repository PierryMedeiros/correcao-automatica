import type { PrismaClient } from '../db/client.js';
import type { Logger } from '../log.js';
import type { ResultadoDoTeardown, Teardown } from './teardown.js';

// Recuperação de órfãos no boot (§10.12, §12).
//
// No MVP há um único processo dono dos jobs. Então **toda** correção `rodando` encontrada no start
// é órfã por definição — inclusive as de container ainda vivo, porque não sobrou ninguém para
// coletar o resultado delas. Não há como distinguir "job em andamento de outro processo" de "job
// abandonado": o segundo é o único caso possível.
//
// Esta é a ÚNICA implementação da marcação do §10.12. A F4 chama esta função no boot e percorre a
// lista devolvida para transicionar cada submissão `corrigindo → na_fila` consumindo retry — o que
// esta fase deliberadamente não faz, porque a máquina de estados da submissão é de lá (§6).

export const MOTIVO_ORFA = 'órfã pós-reinício';
export const EVENTO_ORFA = 'correcao.orfa_recuperada';

export interface CorrecaoRecuperada {
  correcaoId: string;
  submissaoId: string;
  retryN: number;
  teardown: ResultadoDoTeardown;
}

export interface DepsDaRecuperacao {
  prisma: PrismaClient;
  teardown: Teardown;
  logger: Logger;
  agora?: () => Date;
}

export interface Recuperacao {
  /**
   * Marca as correções órfãs como `falhou` e derruba os recursos Docker de cada uma.
   *
   * Devolve o que marcou, com `correcao_id` e `submissao_id`, para quem chamou decidir o que fazer
   * com as submissões (F4). Segunda execução devolve lista vazia: não sobrou nada `rodando`.
   */
  recuperarCorrecoesOrfas(): Promise<CorrecaoRecuperada[]>;
}

export function criarRecuperacao(deps: DepsDaRecuperacao): Recuperacao {
  const { prisma, teardown, logger } = deps;
  const agora = deps.agora ?? (() => new Date());

  return {
    async recuperarCorrecoesOrfas() {
      const orfas = await prisma.correcao.findMany({
        where: { status: 'rodando' },
        select: { id: true, submissaoId: true, retryN: true, startedAt: true },
        orderBy: { id: 'asc' },
      });

      if (orfas.length === 0) {
        logger.info('boot: nenhuma correção órfã (§10.12)');
        return [];
      }

      logger.warn({ orfas: orfas.length }, 'boot: correções órfãs encontradas (§10.12)');
      const recuperadas: CorrecaoRecuperada[] = [];

      for (const orfa of orfas) {
        const correcaoId = orfa.id.toString();
        const submissaoId = orfa.submissaoId.toString();
        const fim = agora();

        // A marcação vem ANTES do teardown de propósito: se o processo cair no meio da
        // recuperação, uma correção marcada com recurso Docker sobrando é problema do janitor
        // (F2.7), enquanto uma correção ainda `rodando` com recurso já removido é uma submissão
        // que ninguém vai reenfileirar.
        await prisma.correcao.update({
          where: { id: orfa.id },
          data: {
            status: 'falhou',
            finishedAt: fim,
            duracaoS: Math.max(0, Math.round((fim.getTime() - orfa.startedAt.getTime()) / 1_000)),
            erroResumo: MOTIVO_ORFA,
          },
        });

        const resultado = await teardown.abortar(correcaoId);

        // Auditoria (§12): a timeline do card precisa explicar por que a correção morreu sem
        // desfecho, e o reinício é a explicação.
        await prisma.evento.create({
          data: {
            submissaoId: orfa.submissaoId,
            tipo: EVENTO_ORFA,
            payload: {
              correcao_id: correcaoId,
              retry_n: orfa.retryN,
              motivo: MOTIVO_ORFA,
              teardown: {
                containers: resultado.containersRemovidos.length,
                networks: resultado.networksRemovidas.length,
                volumes: resultado.volumesRemovidos.length,
                erros: resultado.erros,
              },
            },
          },
        });

        // O job dir fica intacto (§11): a correção existe, logo o dir é referenciado — e é o
        // `runner.log` dele que explica até onde o job tinha chegado quando a máquina caiu.
        recuperadas.push({ correcaoId, submissaoId, retryN: orfa.retryN, teardown: resultado });
      }

      logger.warn(
        { recuperadas: recuperadas.map((r) => r.correcaoId) },
        'boot: órfãs marcadas como `falhou`; re-enfileirar as submissões é de quem chamou (F4)',
      );

      return recuperadas;
    },
  };
}
