import { readdirSync, rmSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '../db/client.js';
import type { DockerCli } from '../jobs/docker.js';
import { LABEL_COMPOSE_PROJECT, LABEL_JOB, correcaoIdDoNome } from '../jobs/nomes.js';
import type { Logger } from '../log.js';

// Janitor (§11, §12): limpa o que escapou do teardown e aplica as duas classes de retenção.
//
// Ele é a rede, não o mecanismo: o caminho normal é o teardown da F2.6 remover tudo no fim de cada
// job. O que chega aqui é resto de processo morto, de reboot e de job fake — e job dir, que o
// teardown nunca apaga de propósito.
//
// Duas regras dominam o arquivo inteiro:
//
//   1. **Nada global — e isto é requisito, não detalhe** (§12, Apêndice B v1.9 item 1). A máquina é
//      de trabalho e roda os containers de outros projetos do operador. Toda remoção parte da
//      pergunta "de qual job é este recurso?", respondida por label `fc.job=<id>`, por
//      `com.docker.compose.project=fc-job-<id>` ou pelo prefixo do nome; "não sei" significa **não
//      tocar**. Nada aqui enxerga a máquina inteira: `prune` é proibido em qualquer forma (regra
//      dura 1) e poda de imagem dangling global ou de cache de build **não são do janitor** — são
//      comandos do runbook, sob decisão humana.
//   2. **Na dúvida, não apaga.** Correção `rodando` protege tudo o que é dela; banco indisponível
//      cancela o ciclo inteiro. Remoção errada aqui é irreversível, e o custo de esperar o próximo
//      ciclo é zero.

const CHAVE_RETENCAO = 'retencao_job_dir_dias';
const CHAVE_DISCO_ALERTA = 'disco_alerta_gb';
const CHAVE_DISCO_PAUSA = 'disco_pausa_gb';
const CHAVE_PAUSA = 'pausa_global';

const MOTIVO_PAUSA_DISCO = 'disco';

const BYTES_POR_GB = 1024 ** 3;

export interface RecursoRemovido {
  nome: string;
  correcaoId: string;
}

export interface JobDirAvaliado {
  caminho: string;
  motivo: string;
}

export interface EstadoDoDisco {
  livreGb: number;
  alertaGb: number;
  pausaGb: number;
  alerta: boolean;
  pausaEscrita: boolean;
}

export interface RelatorioDoJanitor {
  containersRemovidos: RecursoRemovido[];
  networksRemovidas: RecursoRemovido[];
  volumesRemovidos: RecursoRemovido[];
  imagensRemovidas: string[];
  jobDirsRemovidos: JobDirAvaliado[];
  jobDirsPreservados: JobDirAvaliado[];
  disco: EstadoDoDisco | null;
  erros: string[];
}

export interface DepsDoJanitor {
  prisma: PrismaClient;
  docker: DockerCli;
  logger: Logger;
  jobsDir: string;
  agora?: () => Date;
  /** Injetável: é como o teste rebaixa o limiar sem encher o disco de verdade (aceite A5). */
  espacoLivreGb?: (caminho: string) => number;
}

export interface Janitor {
  executarCiclo(): Promise<RelatorioDoJanitor>;
}

/**
 * De qual job é este recurso Docker — se é de algum.
 *
 * As três formas de reconhecer existem porque são três criadores diferentes: o label `fc.job` é
 * nosso (§8), o `com.docker.compose.project` é do compose que o agente rodou (spike S3), e o nome
 * é o que sobra quando um recurso nasceu sem label. `null` é a resposta para tudo o mais — e é ele
 * que impede o janitor de tocar em container de terceiro que apareceu na listagem.
 */
export function identificarJob(nome: string, labels: string): string | null {
  for (const par of labels.split(',')) {
    const separador = par.indexOf('=');
    if (separador < 0) continue;

    const chave = par.slice(0, separador).trim();
    const valor = par.slice(separador + 1).trim();

    if (chave === LABEL_JOB) return valor;
    if (chave === LABEL_COMPOSE_PROJECT) return correcaoIdDoNome(valor);
  }

  return correcaoIdDoNome(nome);
}

function espacoLivreDeVerdade(caminho: string): number {
  const { bavail, bsize } = statfsSync(caminho);
  return (Number(bavail) * Number(bsize)) / BYTES_POR_GB;
}

function numeroDoConfig(
  valores: Map<string, unknown>,
  chave: string,
  padrao: number,
  erros: string[],
): number {
  const valor = valores.get(chave);
  if (typeof valor === 'number') return valor;

  erros.push(`config.${chave} ausente ou não numérica; usando ${padrao}. Rode \`pnpm db:seed\`.`);
  return padrao;
}

export function criarJanitor(deps: DepsDoJanitor): Janitor {
  const { prisma, docker, logger, jobsDir } = deps;
  const agora = deps.agora ?? (() => new Date());
  const espacoLivreGb = deps.espacoLivreGb ?? espacoLivreDeVerdade;

  async function listar(args: string[], erros: string[], contexto: string): Promise<string[]> {
    try {
      const { stdout } = await docker(args);
      return stdout
        .split('\n')
        .map((linha) => linha.trim())
        .filter((linha) => linha.length > 0);
    } catch (erro) {
      erros.push(`${contexto}: ${(erro as Error).message}`);
      return [];
    }
  }

  async function remover(args: string[], erros: string[], contexto: string): Promise<boolean> {
    try {
      await docker(args, { toleraFalha: true });
      return true;
    } catch (erro) {
      erros.push(`${contexto}: ${(erro as Error).message}`);
      return false;
    }
  }

  /** Varre um tipo de recurso, removendo o que é de job que não está mais em execução. */
  async function varrer(
    listagem: string[],
    emVoo: Set<string>,
    remocao: (identificador: string) => string[],
    erros: string[],
    contexto: string,
  ): Promise<RecursoRemovido[]> {
    const removidos: RecursoRemovido[] = [];

    for (const linha of listagem) {
      const [identificador = '', nome = '', labels = ''] = linha.split('\t');
      const correcaoId = identificarJob(nome, labels);

      if (correcaoId === null) continue;
      if (emVoo.has(correcaoId)) continue;

      if (await remover(remocao(identificador), erros, `${contexto} ${nome || identificador}`)) {
        removidos.push({ nome: nome || identificador, correcaoId });
      }
    }

    return removidos;
  }

  /**
   * Job dirs, com as duas classes de retenção do §11.
   *
   * Órfão — nome sem linha em `correcoes` — sai no ciclo, sem olhar idade: é resto de crash antes
   * de persistir ou de job fake. Referenciado, **inclusive por `falhou` e `timeout`**, fica os
   * 14 dias de `config.retencao_job_dir_dias`: é o `runner.log` dele que explica a falha.
   */
  async function varrerJobDirs(
    emVoo: Set<string>,
    retencaoDias: number,
    relatorio: RelatorioDoJanitor,
  ): Promise<void> {
    let nomes: string[];
    try {
      nomes = readdirSync(jobsDir, { withFileTypes: true })
        .filter((entrada) => entrada.isDirectory())
        .map((entrada) => entrada.name);
    } catch (erro) {
      relatorio.erros.push(`listagem de ${jobsDir}: ${(erro as Error).message}`);
      return;
    }

    // Nome que não é id de correção não é job dir nosso — os dos spikes moram no mesmo `$JOBS_DIR`.
    // Preservar é a única resposta segura: "não reconheço" nunca pode virar "então apago".
    const idsNoDisco = nomes.filter((nome) => /^\d+$/.test(nome));
    for (const nome of nomes.filter((n) => !/^\d+$/.test(n))) {
      relatorio.jobDirsPreservados.push({
        caminho: join(jobsDir, nome),
        motivo: 'nome não é id de correção — não é job dir deste sistema',
      });
    }

    const correcoes = await prisma.correcao.findMany({
      where: { id: { in: idsNoDisco.map((id) => BigInt(id)) } },
      select: { id: true, status: true, finishedAt: true, createdAt: true },
    });
    const porId = new Map(correcoes.map((c) => [c.id.toString(), c]));

    const limite = agora().getTime() - retencaoDias * 24 * 60 * 60 * 1_000;

    for (const id of idsNoDisco) {
      const caminho = join(jobsDir, id);
      const correcao = porId.get(id);

      if (!correcao) {
        apagar(caminho, 'órfão: nenhuma correção o referencia (§11)', relatorio);
        continue;
      }
      if (emVoo.has(id)) {
        relatorio.jobDirsPreservados.push({ caminho, motivo: 'correção em execução' });
        continue;
      }

      const referencia = correcao.finishedAt ?? correcao.createdAt;
      if (referencia.getTime() > limite) {
        relatorio.jobDirsPreservados.push({
          caminho,
          motivo: `referenciado por correção \`${correcao.status}\`, dentro dos ${retencaoDias} dias (§11)`,
        });
        continue;
      }

      apagar(
        caminho,
        `referenciado, mas acima dos ${retencaoDias} dias de retenção (§11)`,
        relatorio,
      );
    }
  }

  function apagar(caminho: string, motivo: string, relatorio: RelatorioDoJanitor): void {
    try {
      rmSync(caminho, { recursive: true, force: true });
      relatorio.jobDirsRemovidos.push({ caminho, motivo });
    } catch (erro) {
      relatorio.erros.push(`remoção de ${caminho}: ${(erro as Error).message}`);
    }
  }

  /**
   * Imagens que as stacks dos alunos buildaram e escaparam do teardown.
   *
   * Escopo estrito ao prefixo `fc-job-` (§12, Apêndice B v1.9 item 1). A máquina é de trabalho e
   * roda os containers de outros projetos do operador: a varredura de dangling **global**, que era
   * o que o §12 pedia até a v1.9, enxergaria o build intermediário sem tag de qualquer projeto
   * dele. Dangling global e cache de build são comandos do runbook, sob decisão humana — nunca
   * rotina automática.
   *
   * O caminho normal é outro: o teardown roda `compose down --rmi local` e remove essas imagens no
   * fim de cada job. O que chega aqui é resto de job cujo teardown não rodou.
   */
  async function podarImagensDoJob(
    emVoo: Set<string>,
    relatorio: RelatorioDoJanitor,
  ): Promise<void> {
    const listagem = await listar(
      ['images', '--format', '{{.ID}}\t{{.Repository}}:{{.Tag}}\t{{.Repository}}'],
      relatorio.erros,
      'listagem de imagens',
    );

    for (const linha of listagem) {
      const [id = '', referencia = '', repositorio = ''] = linha.split('\t');
      const correcaoId = correcaoIdDoNome(repositorio);

      if (correcaoId === null || emVoo.has(correcaoId)) continue;

      // Imagem em uso por container recusa a remoção, e é o comportamento desejado: quem decide
      // que ela ainda serve é o daemon, não nós.
      try {
        await docker(['rmi', id], { toleraFalha: true });
        relatorio.imagensRemovidas.push(referencia);
      } catch {
        // Silencioso de propósito: "em uso" é o caso comum e não é problema a relatar.
      }
    }
  }

  /**
   * Disco (§10.19): alerta abaixo de `disco_alerta_gb`, pausa global abaixo de `disco_pausa_gb`.
   *
   * A pausa é escrita como objeto (D9, formato semeado pela F1) e **não** sobrescreve uma pausa já
   * ativa: se o sistema já parou por limite de plano, trocar o motivo para "disco" apagaria a razão
   * verdadeira. Quem obedece ao registro é a F4.
   */
  async function vigiarDisco(
    alertaGb: number,
    pausaGb: number,
    relatorio: RelatorioDoJanitor,
  ): Promise<void> {
    let livreGb: number;
    try {
      livreGb = espacoLivreGb(jobsDir);
    } catch (erro) {
      relatorio.erros.push(`leitura do disco: ${(erro as Error).message}`);
      return;
    }

    const estado: EstadoDoDisco = {
      livreGb: Math.round(livreGb * 100) / 100,
      alertaGb,
      pausaGb,
      alerta: livreGb < alertaGb,
      pausaEscrita: false,
    };
    relatorio.disco = estado;

    if (estado.alerta) {
      logger.warn(
        { livre_gb: estado.livreGb, alerta_gb: alertaGb },
        'disco abaixo do alerta (§10.19)',
      );
    }
    if (livreGb >= pausaGb) return;

    const atual = await prisma.config.findUnique({ where: { chave: CHAVE_PAUSA } });
    const valor = atual?.valor;
    const jaAtiva =
      typeof valor === 'object' && valor !== null && (valor as { ativa?: unknown }).ativa === true;

    if (jaAtiva) {
      logger.error(
        { livre_gb: estado.livreGb, pausa_gb: pausaGb },
        'disco crítico, mas já existe pausa global ativa: motivo anterior preservado',
      );
      return;
    }

    await prisma.config.update({
      where: { chave: CHAVE_PAUSA },
      data: {
        valor: {
          ativa: true,
          motivo: MOTIVO_PAUSA_DISCO,
          desde: agora().toISOString(),
          tentativas: 0,
        },
      },
    });
    await prisma.notificacao.create({
      data: {
        tipo: 'pausa_global',
        texto:
          `Pausa global automática: restam ${estado.livreGb} GB livres, abaixo do limiar de ` +
          `${pausaGb} GB (§10.19). Nenhum job novo inicia até liberar espaço.`,
      },
    });

    estado.pausaEscrita = true;
    logger.error(
      { livre_gb: estado.livreGb, pausa_gb: pausaGb },
      'pausa global por disco (§10.19)',
    );
  }

  return {
    async executarCiclo() {
      const relatorio: RelatorioDoJanitor = {
        containersRemovidos: [],
        networksRemovidas: [],
        volumesRemovidos: [],
        imagensRemovidas: [],
        jobDirsRemovidos: [],
        jobDirsPreservados: [],
        disco: null,
        erros: [],
      };

      // FAIL-SAFE (§11): sem saber quais correções estão `rodando`, não há como distinguir job em
      // execução de resto abandonado. O ciclo inteiro é cancelado — nem Docker, nem job dir, nem
      // disco. Perder um ciclo custa nada; matar um job em execução custa a correção.
      let emVoo: Set<string>;
      let retencaoDias: number;
      let alertaGb: number;
      let pausaGb: number;
      try {
        const rodando = await prisma.correcao.findMany({
          where: { status: 'rodando' },
          select: { id: true },
        });
        emVoo = new Set(rodando.map((c) => c.id.toString()));

        const config = await prisma.config.findMany({
          where: { chave: { in: [CHAVE_RETENCAO, CHAVE_DISCO_ALERTA, CHAVE_DISCO_PAUSA] } },
        });
        const valores = new Map<string, unknown>(config.map((c) => [c.chave, c.valor]));

        retencaoDias = numeroDoConfig(valores, CHAVE_RETENCAO, 14, relatorio.erros);
        alertaGb = numeroDoConfig(valores, CHAVE_DISCO_ALERTA, 15, relatorio.erros);
        pausaGb = numeroDoConfig(valores, CHAVE_DISCO_PAUSA, 5, relatorio.erros);
      } catch (erro) {
        const mensagem = `banco indisponível: nenhum recurso foi removido neste ciclo. ${(erro as Error).message}`;
        relatorio.erros.push(mensagem);
        logger.error({ erro: (erro as Error).message }, mensagem);
        return relatorio;
      }

      relatorio.containersRemovidos = await varrer(
        await listar(
          ['ps', '-a', '--no-trunc', '--format', '{{.ID}}\t{{.Names}}\t{{.Labels}}'],
          relatorio.erros,
          'listagem de containers',
        ),
        emVoo,
        (id) => ['rm', '-f', id],
        relatorio.erros,
        'remoção do container',
      );

      relatorio.networksRemovidas = await varrer(
        await listar(
          ['network', 'ls', '--no-trunc', '--format', '{{.ID}}\t{{.Name}}\t{{.Labels}}'],
          relatorio.erros,
          'listagem de networks',
        ),
        emVoo,
        (id) => ['network', 'rm', id],
        relatorio.erros,
        'remoção da network',
      );

      relatorio.volumesRemovidos = await varrer(
        await listar(
          ['volume', 'ls', '--format', '{{.Name}}\t{{.Name}}\t{{.Labels}}'],
          relatorio.erros,
          'listagem de volumes',
        ),
        emVoo,
        (nome) => ['volume', 'rm', nome],
        relatorio.erros,
        'remoção do volume',
      );

      await varrerJobDirs(emVoo, retencaoDias, relatorio);
      await podarImagensDoJob(emVoo, relatorio);
      await vigiarDisco(alertaGb, pausaGb, relatorio);

      logger.info(
        {
          containers: relatorio.containersRemovidos.length,
          networks: relatorio.networksRemovidas.length,
          volumes: relatorio.volumesRemovidos.length,
          imagens: relatorio.imagensRemovidas.length,
          job_dirs_removidos: relatorio.jobDirsRemovidos.length,
          job_dirs_preservados: relatorio.jobDirsPreservados.length,
          erros: relatorio.erros.length,
        },
        'ciclo do janitor concluído',
      );

      return relatorio;
    },
  };
}
