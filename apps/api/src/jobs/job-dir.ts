import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { caminhoDoJobDir, projetoCompose } from './nomes.js';
import { gerarOverrideDoCompose, type AnaliseDoCompose } from './override-noports.js';

// O job dir é o único canal entre o host e o runner (plan §8, §9.2 passo 3): o controller escreve
// aqui antes do `docker create`, o runner lê e escreve de dentro, e o que sobra depois é o que a
// auditoria tem (§11). Nada de rede, nada de API — arquivo em diretório montado.

export const ARQUIVO_JOB_JSON = 'job.json';
export const ARQUIVO_COMPOSE_BASE = 'compose-aluno.yaml';
export const ARQUIVO_COMPOSE_OVERRIDE = 'compose.override.yaml';
export const ARQUIVO_RESULTADO = 'resultado.json';
export const ARQUIVO_CLONE = 'clone.json';
export const ARQUIVO_LOG = 'runner.log';
export const ARQUIVO_TRANSCRIPT = 'transcript.jsonl';
export const ARQUIVO_DOSSIE = 'dossie.json';
export const ARQUIVO_SENTINELA = 'encerrar';

/** Escrito pelo controller, lido pelo entrypoint com `jq` e, na F3, pelo montador do `prompt.txt`.
 *  As chaves são snake_case porque é assim que o domínio se chama no banco e no `jq` do runner. */
export interface JobJson {
  job_id: string;
  correcao_id: string;
  submissao_id: string;
  aluno: { nome: string; email: string };
  projeto: string;
  fase: string;
  skill_slug: string;
  repo_url: string;
  commit_sha: string | null;
  modelo: string;
  timeout_s: number;
  job_dir: string;
  compose_project: string;
  compose: ComposeDoJob | null;
}

export interface ComposeDoJob {
  arquivo_base: string;
  arquivo_override: string;
  /** Entregue pronto ao agente (§8, §9.2): ele não inventa `-p` nem gera override. */
  comando_canonico: string;
  servicos: string[];
  /** §10.15 — quem trazia nome fixo. O campo equivalente do dossiê é do agente (F3). */
  servicos_com_container_name_fixo: string[];
}

export interface DadosDoJob {
  correcaoId: string;
  submissaoId: string;
  alunoNome: string;
  alunoEmail: string;
  projeto: string;
  fase: string;
  skillSlug: string;
  repoUrl: string;
  commitSha: string | null;
  modelo: string;
  timeoutS: number;
}

/**
 * Compose do aluno que o controller já conhece na hora de montar o job dir.
 *
 * No fluxo real ele só existe depois do clone, que acontece dentro do runner (§9.2 passo 4) — a
 * F2 fecha com esse ponto em aberto e ele está registrado no arquivo da fase e no STATUS.md como
 * a costura F2/F3. O harness de job fake entrega o compose por aqui, que é o que permite exercitar
 * o override e o comando canônico sem depender do agente.
 */
export interface ComposeConhecido {
  conteudo: string;
}

export interface JobDirCriado {
  caminho: string;
  jobJson: JobJson;
  analiseDoCompose: AnaliseDoCompose | null;
}

/**
 * Monta o comando canônico de compose com os **caminhos absolutos do job dir**, nunca com
 * `/workspace`.
 *
 * Não é preferência de estilo: quem sobe a stack é o daemon do host, e ele resolve os caminhos do
 * compose do lado de lá. Com `-f /workspace/...`, o `./dados` do aluno vira `/workspace/dados`, que
 * no host não existe — e o daemon não recusa, cria um diretório vazio e monta. A stack sobe, o
 * serviço roda sem os arquivos do aluno e a correção avalia um ambiente que não é o dele, sem erro
 * nenhum no caminho (spike S3, plan §8 e Apêndice B v1.6 item 1). O job dir é montado duas vezes
 * justamente para este comando poder usar o caminho absoluto.
 */
export function montarComandoCanonico(
  correcaoId: string,
  caminhoBase: string,
  caminhoOverride: string,
): string {
  return `docker compose -p ${projetoCompose(correcaoId)} -f ${caminhoBase} -f ${caminhoOverride}`;
}

/**
 * Cria `$JOBS_DIR/<correcao_id>/` e escreve nele tudo o que o runner precisa.
 *
 * Falha se o diretório já existir: job dir repetido significa dois jobs escrevendo o mesmo
 * `resultado.json`, e o segundo colheria o artefato do primeiro.
 */
export function criarJobDir(
  jobsDir: string,
  dados: DadosDoJob,
  networkDoJob: string,
  compose?: ComposeConhecido,
): JobDirCriado {
  const caminho = caminhoDoJobDir(jobsDir, dados.correcaoId);

  mkdirSync(jobsDir, { recursive: true });
  // O runner escreve aqui como uid 1000 (§8). Em máquina cujo usuário não seja 1000, o sintoma é
  // "dossiê ausente" (§10.7), que aponta para o lugar errado — está nos riscos do arquivo da fase.
  mkdirSync(caminho, { recursive: false, mode: 0o755 });

  let composeDoJob: ComposeDoJob | null = null;
  let analiseDoCompose: AnaliseDoCompose | null = null;

  if (compose) {
    const caminhoBase = join(caminho, ARQUIVO_COMPOSE_BASE);
    const caminhoOverride = join(caminho, ARQUIVO_COMPOSE_OVERRIDE);
    const { override, analise } = gerarOverrideDoCompose(compose.conteudo, networkDoJob);

    writeFileSync(caminhoBase, compose.conteudo, 'utf8');
    writeFileSync(caminhoOverride, override, 'utf8');

    analiseDoCompose = analise;
    composeDoJob = {
      arquivo_base: caminhoBase,
      arquivo_override: caminhoOverride,
      comando_canonico: montarComandoCanonico(dados.correcaoId, caminhoBase, caminhoOverride),
      servicos: analise.servicos,
      servicos_com_container_name_fixo: analise.servicosComContainerNameFixo,
    };
  }

  const jobJson: JobJson = {
    job_id: dados.correcaoId,
    correcao_id: dados.correcaoId,
    submissao_id: dados.submissaoId,
    aluno: { nome: dados.alunoNome, email: dados.alunoEmail },
    projeto: dados.projeto,
    fase: dados.fase,
    skill_slug: dados.skillSlug,
    repo_url: dados.repoUrl,
    commit_sha: dados.commitSha,
    modelo: dados.modelo,
    timeout_s: dados.timeoutS,
    job_dir: caminho,
    compose_project: projetoCompose(dados.correcaoId),
    compose: composeDoJob,
  };

  writeFileSync(join(caminho, ARQUIVO_JOB_JSON), `${JSON.stringify(jobJson, null, 2)}\n`, 'utf8');

  return { caminho, jobJson, analiseDoCompose };
}
