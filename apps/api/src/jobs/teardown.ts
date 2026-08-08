import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '../log.js';
import type { DockerCli } from './docker.js';
import { ARQUIVO_SENTINELA } from './job-dir.js';
import {
  caminhoDoJobDir,
  labelDoJob,
  labelDoProjetoCompose,
  networkDoJob,
  nomeDoRunner,
  projetoCompose,
} from './nomes.js';

// Camada 2 do teardown do §8: o que o sistema criou, o sistema derruba — em qualquer desfecho.
//
// Ela é obrigatória, não otimização. O runner fica vivo de propósito (§8, v1.5, D10), então um
// caminho de saída que não passe por aqui deixa container de pé para sempre; o que escapar só sai
// pelo janitor (F2.7) ou pela recuperação de boot (F2.8).
//
// Toda remoção é por nome exato do job ou por filtro de label dele (regra dura 1 e 2). Não existe
// `prune` neste arquivo, nem filtrado, e nada aqui alcança recurso que não seja deste job: a
// máquina é de trabalho e roda os containers de outros projetos do operador (§12, Apêndice B v1.9).
//
// Idempotente por construção: cada passo tolera "não existe". Rodar duas vezes é o caso normal,
// não a exceção — o janitor e a recuperação de órfãos chamam isto sobre job que talvez já tenha
// sido derrubado.

/** Grace do `docker stop`. Curto porque a sentinela já pediu o encerramento: o runner sai em ~1s
 *  e este número só existe para o caso de ele estar preso em algo que ignora o pedido. */
const GRACE_DO_STOP_S = 10;

/**
 * "O recurso não existe" dito pelo daemon, nas três formas em que ele o diz.
 *
 * Casar mensagem de erro é frágil e sabemos disso — a alternativa era uma chamada de existência
 * antes de cada remoção, dobrando o número de idas ao daemon num caminho que roda em todo fim de
 * job. Se o texto mudar, o sintoma é benigno: ausência passa a ser contada como erro no relatório,
 * e o teste de idempotência quebra alto.
 */
function ehAusencia(erro: unknown): boolean {
  return /no such|not found/i.test((erro as Error)?.message ?? '');
}

export interface ResultadoDoTeardown {
  correcaoId: string;
  containersRemovidos: string[];
  networksRemovidas: string[];
  volumesRemovidos: string[];
  /** Falhas toleradas: o teardown segue mesmo assim, mas elas precisam aparecer no log e no relatório. */
  erros: string[];
}

export interface DepsDoTeardown {
  docker: DockerCli;
  logger: Logger;
  jobsDir: string;
}

export interface Teardown {
  /** Sinaliza o fim ao runner e remove todo recurso Docker do job. Nunca toca no job dir (§11). */
  encerrar(correcaoId: string): Promise<ResultadoDoTeardown>;
  /** Kill + teardown. É a primitiva que o cancelamento e a substituição da F4 consomem (§6). */
  abortar(correcaoId: string): Promise<ResultadoDoTeardown>;
}

export function criarTeardown(deps: DepsDoTeardown): Teardown {
  const { docker, logger, jobsDir } = deps;

  /**
   * Executa um passo do teardown sem deixar que ele derrube os seguintes.
   *
   * Devolve `null` quando o recurso não existe — que é o caso **normal**, não a exceção: o segundo
   * teardown do mesmo job não acha nada, e é assim que a idempotência do §8 se prova. Só falha de
   * verdade entra em `erros`; a ausência não, senão "rodar duas vezes" pareceria erro no relatório.
   */
  async function tolerando(
    args: string[],
    erros: string[],
    contexto: string,
  ): Promise<string | null> {
    try {
      const { stdout } = await docker(args, { toleraFalha: true });
      return stdout;
    } catch (erro) {
      if (!ehAusencia(erro)) erros.push(`${contexto}: ${(erro as Error).message}`);
      return null;
    }
  }

  function linhas(saida: string | null): string[] {
    return (saida ?? '')
      .split('\n')
      .map((linha) => linha.trim())
      .filter((linha) => linha.length > 0);
  }

  /**
   * Pede ao runner que encerre antes de removê-lo.
   *
   * A sentinela é o caminho educado: o entrypoint sai do laço de espera, fecha o log e devolve o
   * exit code. `docker stop` vem em seguida como garantia, e o `rm -f` lá embaixo como garantia da
   * garantia — nenhum dos três pode ser o único, porque o job dir pode ter sumido, o container
   * pode estar travado e o daemon pode ter reiniciado.
   */
  async function sinalizarEncerramento(correcaoId: string, erros: string[]): Promise<void> {
    const jobDir = caminhoDoJobDir(jobsDir, correcaoId);
    if (existsSync(jobDir)) {
      try {
        writeFileSync(join(jobDir, ARQUIVO_SENTINELA), `${new Date().toISOString()}\n`, 'utf8');
      } catch (erro) {
        erros.push(`sentinela: ${(erro as Error).message}`);
      }
    }

    await tolerando(
      ['stop', '--timeout', String(GRACE_DO_STOP_S), nomeDoRunner(correcaoId)],
      erros,
      'stop do runner',
    );
  }

  async function removerContainersDaStack(correcaoId: string, erros: string[]): Promise<string[]> {
    const ids = linhas(
      await tolerando(
        ['ps', '-aq', '--filter', `label=${labelDoProjetoCompose(correcaoId)}`],
        erros,
        'listagem da stack do aluno',
      ),
    );
    if (ids.length === 0) return [];

    await tolerando(['rm', '-f', ...ids], erros, 'remoção da stack do aluno');
    return ids;
  }

  async function removerNetworks(correcaoId: string, erros: string[]): Promise<string[]> {
    const nomes = new Set<string>([networkDoJob(correcaoId)]);

    for (const filtro of [labelDoJob(correcaoId), labelDoProjetoCompose(correcaoId)]) {
      for (const nome of linhas(
        await tolerando(
          ['network', 'ls', '--filter', `label=${filtro}`, '--format', '{{.Name}}'],
          erros,
          'listagem de networks',
        ),
      )) {
        nomes.add(nome);
      }
    }

    const removidas: string[] = [];
    for (const nome of nomes) {
      // O inspect é a checagem de existência e a lista de endpoints de uma vez. Network que não
      // existe cai fora aqui, em silêncio — é o segundo teardown do mesmo job.
      const anexados = await tolerando(
        ['network', 'inspect', nome, '--format', '{{range .Containers}}{{.Name}}\n{{end}}'],
        erros,
        `inspeção de ${nome}`,
      );
      if (anexados === null) continue;

      // Sobra endpoint quando um container de fora entrou na network do job, ou quando o daemon
      // ainda não soltou o que acabamos de remover. `network rm` recusa nos dois casos.
      for (const container of linhas(anexados)) {
        await tolerando(
          ['network', 'disconnect', '-f', nome, container],
          erros,
          `desconexão de ${container}`,
        );
      }

      if ((await tolerando(['network', 'rm', nome], erros, `remoção de ${nome}`)) !== null) {
        removidas.push(nome);
      }
    }

    return removidas;
  }

  async function removerVolumes(correcaoId: string, erros: string[]): Promise<string[]> {
    const nomes = new Set<string>();

    for (const filtro of [labelDoJob(correcaoId), labelDoProjetoCompose(correcaoId)]) {
      for (const nome of linhas(
        await tolerando(
          ['volume', 'ls', '-q', '--filter', `label=${filtro}`],
          erros,
          'listagem de volumes',
        ),
      )) {
        nomes.add(nome);
      }
    }
    if (nomes.size === 0) return [];

    await tolerando(['volume', 'rm', ...nomes], erros, 'remoção de volumes');
    return [...nomes];
  }

  async function encerrar(correcaoId: string): Promise<ResultadoDoTeardown> {
    const log = logger.child({ job_id: correcaoId });
    const erros: string[] = [];
    const containersRemovidos: string[] = [];

    await sinalizarEncerramento(correcaoId, erros);

    // A ORDEM É O CONTRATO (§8 camada 2). A stack do aluno sai primeiro porque é ela que segura os
    // endpoints da network; o runner depois; a network só quando ninguém mais está nela.
    // `--rmi local` porque `down` sozinho NÃO remove as imagens que a stack do aluno buildou: elas
    // nascem como `fc-job-<id>-<serviço>` e ficariam no disco para sempre, uma por correção de um
    // desafio que builda — que é a maioria. `local` e não `all`: `all` levaria junto as imagens que
    // o compose só puxou do registry (`postgres:16`, `node:22`), compartilhadas com a máquina
    // inteira (§8, Apêndice B v1.9 item 2).
    await tolerando(
      [
        'compose',
        '-p',
        projetoCompose(correcaoId),
        'down',
        '-v',
        '--rmi',
        'local',
        '--remove-orphans',
      ],
      erros,
      'compose down',
    );
    containersRemovidos.push(...(await removerContainersDaStack(correcaoId, erros)));

    // A listagem antes do `rm -f` não é cerimônia: `docker rm -f` sai 0 para container que não
    // existe, então sem ela o relatório afirmaria ter removido um runner que já tinha morrido — e
    // esse número vai para `eventos` na recuperação de órfãos (§12).
    const runner = nomeDoRunner(correcaoId);
    const existeRunner = linhas(
      await tolerando(['ps', '-aq', '--filter', `name=^${runner}$`], erros, 'listagem do runner'),
    );
    if (existeRunner.length > 0) {
      await tolerando(['rm', '-f', runner], erros, 'remoção do runner');
      containersRemovidos.push(runner);
    }

    const networksRemovidas = await removerNetworks(correcaoId, erros);
    const volumesRemovidos = await removerVolumes(correcaoId, erros);

    // O job dir fica (§11). Limpeza de disco é do janitor, e é ele quem sabe se este dir ainda é
    // referenciado por uma correção — apagar aqui destruiria o `runner.log` da falha que se está
    // justamente tentando explicar.
    const resultado: ResultadoDoTeardown = {
      correcaoId,
      containersRemovidos,
      networksRemovidas,
      volumesRemovidos,
      erros,
    };

    log.info(
      {
        containers: containersRemovidos.length,
        networks: networksRemovidas.length,
        volumes: volumesRemovidos.length,
        erros: erros.length,
      },
      'teardown concluído',
    );

    return resultado;
  }

  return {
    encerrar,

    async abortar(correcaoId) {
      // `kill` antes de tudo: aqui não se está esperando o job terminar bem, está-se interrompendo
      // (cancelamento, substituição, órfã pós-reinício). A sentinela do `encerrar` vira redundância
      // inofensiva sobre um container que já morreu.
      logger.child({ job_id: correcaoId }).warn('abortando o job (kill + teardown)');
      try {
        await docker(['kill', nomeDoRunner(correcaoId)], { toleraFalha: true });
      } catch {
        // Container já morto ou inexistente é o desfecho esperado de um abort tardio.
      }
      return encerrar(correcaoId);
    },
  };
}
