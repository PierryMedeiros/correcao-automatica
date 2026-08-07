import { parse } from 'yaml';

// Gerador do override que neutraliza o compose do aluno (plan §8, §10.14, §10.15).
//
// Duas coisas o override precisa fazer, e o spike S3 provou as duas em bancada:
//   1. apagar `ports:` e `container_name:` de TODOS os serviços — porta publicada faz o segundo job
//      do mesmo desafio morrer com "address already in use", e nome fixo faz o segundo container
//      colidir com o primeiro;
//   2. apontar as networks para a externa `fc-job-<id>_net`, criada pelo Job Controller antes do
//      runner, para a stack nascer alcançável por hostname de dentro do runner.
//
// A tag `!reset` (Compose ≥ 2.24) é obrigatória: merge de lista em override **concatena**, então
// `ports: []` puro não remove porta nenhuma. É por isso que o override é texto montado aqui e não
// serialização de objeto — a tag não sobrevive a um round-trip pelo serializador de YAML.

/** Nome de serviço de compose. Validar não é preciosismo: o nome vem do repo do aluno e é
 *  interpolado em YAML que nós geramos — um nome com `:` ou `\n` viraria injeção de chave. */
const NOME_DE_SERVICO_VALIDO = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export class ComposeInvalidoError extends Error {
  constructor(motivo: string) {
    super(`compose do aluno inválido: ${motivo}`);
    this.name = 'ComposeInvalidoError';
  }
}

export interface AnaliseDoCompose {
  servicos: string[];
  /** §10.15 pede o registro de quem trazia nome fixo — vai para o `job.json`. */
  servicosComContainerNameFixo: string[];
  /** Declaradas no topo ou referenciadas por algum serviço; `default` sempre entra. */
  networks: string[];
}

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** Networks que um serviço referencia — o Compose aceita lista (`- backend`) ou mapa. */
function networksDoServico(servico: unknown): string[] {
  if (!ehObjeto(servico)) return [];
  const declaradas = servico['networks'];
  if (Array.isArray(declaradas))
    return declaradas.filter((n): n is string => typeof n === 'string');
  if (ehObjeto(declaradas)) return Object.keys(declaradas);
  return [];
}

export function analisarCompose(texto: string): AnaliseDoCompose {
  let documento: unknown;
  try {
    documento = parse(texto);
  } catch (erro) {
    throw new ComposeInvalidoError(`YAML não parseável (${(erro as Error).message})`);
  }

  if (!ehObjeto(documento)) throw new ComposeInvalidoError('o arquivo não é um mapa YAML');

  const servicos = documento['services'];
  if (!ehObjeto(servicos) || Object.keys(servicos).length === 0) {
    throw new ComposeInvalidoError('nenhum serviço declarado em `services:`');
  }

  const nomes = Object.keys(servicos);
  const invalido = nomes.find((nome) => !NOME_DE_SERVICO_VALIDO.test(nome));
  if (invalido !== undefined) {
    throw new ComposeInvalidoError(`nome de serviço fora do formato do Compose: ${invalido}`);
  }

  // `default` sempre entra: serviço sem `networks:` cai nela, e é ela que precisa apontar para a
  // network do job. Compose sem `networks:` no topo é o caso comum, não a exceção.
  const networks = new Set<string>(['default']);
  const declaradasNoTopo = documento['networks'];
  if (ehObjeto(declaradasNoTopo)) Object.keys(declaradasNoTopo).forEach((n) => networks.add(n));
  nomes.forEach((nome) => networksDoServico(servicos[nome]).forEach((n) => networks.add(n)));

  const invalidaNaRede = [...networks].find((nome) => !NOME_DE_SERVICO_VALIDO.test(nome));
  if (invalidaNaRede !== undefined) {
    throw new ComposeInvalidoError(`nome de network fora do formato do Compose: ${invalidaNaRede}`);
  }

  return {
    servicos: nomes,
    servicosComContainerNameFixo: nomes.filter((nome) => {
      const servico = servicos[nome];
      return ehObjeto(servico) && typeof servico['container_name'] === 'string';
    }),
    networks: [...networks],
  };
}

/**
 * Monta o texto do override. Puro: mesma entrada, mesma saída, byte a byte.
 *
 * **Todas** as networks do compose vão para a mesma network externa do job, não só a `default`.
 * Compose de aluno que separa `frontend`/`backend` criaria networks próprias do projeto, das quais
 * o runner não participa — e o agente perderia o acesso por hostname que o §8 exige. O preço é
 * achatar uma segmentação que o desafio talvez avaliasse; o benefício é a correção conseguir
 * enxergar a stack. Divergência registrada no arquivo da fase.
 */
export function gerarOverrideNoports(analise: AnaliseDoCompose, networkDoJob: string): string {
  if (!NOME_DE_SERVICO_VALIDO.test(networkDoJob)) {
    throw new ComposeInvalidoError(`nome de network do job inválido: ${networkDoJob}`);
  }

  const linhas = [
    '# GERADO pelo Banca (apps/api/src/jobs/override-noports.ts) — não editar à mão.',
    '# Neutraliza portas e nomes fixos do compose do aluno e prende a stack na network do job',
    '# (plan §8, §10.14, §10.15). `!reset` é necessário: merge de lista em Compose concatena.',
    'services:',
  ];

  for (const servico of analise.servicos) {
    linhas.push(`  ${servico}:`, '    ports: !reset []', '    container_name: !reset null');
  }

  linhas.push('networks:');
  for (const network of analise.networks) {
    linhas.push(`  ${network}:`, `    name: ${networkDoJob}`, '    external: true');
  }

  return `${linhas.join('\n')}\n`;
}

export function gerarOverrideDoCompose(
  texto: string,
  networkDoJob: string,
): { override: string; analise: AnaliseDoCompose } {
  const analise = analisarCompose(texto);
  return { override: gerarOverrideNoports(analise, networkDoJob), analise };
}
