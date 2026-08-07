import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Constrói o repositório do "aluno" do job fake como **bare repo local**, clonado por `file://`.
//
// Mesma escolha dos golden repos (§14, Apêndice B v1.1): o teste não pode depender de rede nem de
// um repositório de terceiro continuar existindo daqui a um ano. E ele nasce dentro do job dir
// porque é o único caminho do host que o runner enxerga — `/tmp` do host não está montado lá.

const FIXTURE = fileURLToPath(new URL('fixtures/repo-exemplo', import.meta.url));

export const NOME_DO_BARE = 'repo-exemplo.git';

/** URL que o entrypoint recebe no `job.json`: o job dir é `/workspace` dentro do runner. */
export const URL_DO_BARE = `file:///workspace/${NOME_DO_BARE}`;

export interface RepoFixture {
  caminhoBare: string;
  repoUrl: string;
  commitSha: string;
}

export interface OpcoesDaFixture {
  /** Acrescenta um `.gitmodules` apontando para lugar nenhum, para exercitar o §10.18. */
  comSubmoduleQuebrado?: boolean;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.email=banca@exemplo.invalido', '-c', 'user.name=Banca', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

/**
 * Cria `<jobDir>/repo-exemplo.git` e devolve o SHA do commit que o job deve avaliar.
 *
 * O SHA sai daqui, e não de um literal: é ele que o entrypoint faz checkout, então precisa ser o
 * do commit que acabou de nascer.
 */
export function criarRepoBare(jobDir: string, opcoes: OpcoesDaFixture = {}): RepoFixture {
  const trabalho = mkdtempSync(join(tmpdir(), 'banca-fixture-'));

  try {
    cpSync(FIXTURE, trabalho, { recursive: true });

    if (opcoes.comSubmoduleQuebrado) {
      writeFileSync(
        join(trabalho, '.gitmodules'),
        '[submodule "dependencia"]\n' +
          '\tpath = dependencia\n' +
          '\turl = /caminho/que/nao/existe.git\n',
        'utf8',
      );
    }

    git(trabalho, 'init', '--quiet', '-b', 'main');
    git(trabalho, 'add', '--all');
    git(trabalho, 'commit', '--quiet', '-m', 'entrega do aluno (fixture do job fake)');

    if (opcoes.comSubmoduleQuebrado) {
      // Só o `.gitmodules` não quebra nada: sem uma entrada de gitlink na árvore, o
      // `submodule update --init` não tem o que inicializar e sai 0. O submodule só é submodule
      // com o modo 160000 no índice — foi o teste do §10.18 que cobrou isso.
      const alvo = git(trabalho, 'rev-parse', 'HEAD');
      git(trabalho, 'update-index', '--add', '--cacheinfo', `160000,${alvo},dependencia`);
      git(trabalho, 'commit', '--quiet', '-m', 'submodule apontando para repositório inexistente');
    }

    const commitSha = git(trabalho, 'rev-parse', 'HEAD');

    const caminhoBare = join(jobDir, NOME_DO_BARE);
    git(trabalho, 'clone', '--bare', '--quiet', trabalho, caminhoBare);

    return { caminhoBare, repoUrl: URL_DO_BARE, commitSha };
  } finally {
    rmSync(trabalho, { recursive: true, force: true });
  }
}
