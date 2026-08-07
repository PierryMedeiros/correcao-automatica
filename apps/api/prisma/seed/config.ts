import type { Prisma } from '../../generated/client.js';
import type { PrismaClient } from '../../src/db/client.js';

// Defaults operacionais do §10/§11/§12. Nascem em `config` — e não como literal no código — para
// que calibrar seja mudar uma linha do banco, não recompilar. Cada `descricao` aponta a seção de
// origem, que é o que permite recalibrar sem reabrir o plano inteiro atrás do porquê do número.

interface Padrao {
  chave: string;
  valor: Prisma.InputJsonValue;
  descricao: string;
}

export const CONFIG_PADRAO: readonly Padrao[] = [
  {
    chave: 'pausa_global',
    // Objeto, nunca booleano: a pausa automática precisa registrar por quê e desde quando, senão o
    // operador vê o sistema parado sem saber se foi limite de plano, credencial ou disco.
    valor: { ativa: false, motivo: null, desde: null, tentativas: 0 },
    descricao:
      'plan §12 — pausa do sistema inteiro. `motivo` ∈ {manual, limite_plano, credencial, disco} ' +
      '(§10.10, §10.11, §10.19); `desde` é ISO-8601; `tentativas` conta a retomada escalonada (§10.10).',
  },
  {
    chave: 'devolutiva_link_invalido_template',
    valor: [
      'Olá, {{aluno_nome}}!',
      '',
      'Não consegui avaliar sua entrega de {{projeto}} — {{fase}} porque não consegui acessar o',
      'repositório enviado: {{repo_url}}',
      '',
      'Motivo: {{motivo}}',
      '',
      'Confira se o repositório é público e se o link aponta para o repositório em si — não para uma',
      'pasta, um pull request ou a aplicação publicada — e reenvie sua entrega. Assim que ela chegar,',
      'sigo com a correção.',
    ].join('\n'),
    descricao:
      'plan §6, §10.1–2, §10.31 — devolutiva de `link_invalido`, gerada sem gastar agente. ' +
      '`{{motivo}}` recebe o texto do caso (repositório privado, inexistente, link do repositório ' +
      'base do desafio, URL que não é de repositório).',
  },
  {
    chave: 'gatilho_tamanho_aprovado_frases',
    valor: 5,
    descricao:
      'plan §10.25, §12 — devolutiva de aprovado acima disto força revisão. Limiar global.',
  },
  {
    chave: 'gatilho_tamanho_aprovado_caracteres',
    valor: 700,
    descricao: 'plan §10.25, §12 — idem, em caracteres.',
  },
  {
    chave: 'gatilho_tamanho_reprovado_frases',
    valor: 20,
    descricao: 'plan §10.25, §12 — devolutiva de reprovado acima disto força revisão.',
  },
  {
    chave: 'gatilho_similaridade_limiar',
    valor: 0.6,
    descricao:
      'plan §10.24, §12 — similaridade trigram (pg_trgm) contra devolutivas já geradas da mesma ' +
      'skill. Valor inicial; calibrar na F7 com dados reais.',
  },
  {
    chave: 'gatilho_duracao_min_amostras',
    valor: 10,
    descricao:
      'plan §12 — o critério de duração anômala por p95 só vale com pelo menos este número de ' +
      'correções concluídas da skill. Abaixo disso não há p95 confiável.',
  },
  {
    chave: 'gatilho_duracao_fracao_timeout',
    valor: 0.8,
    descricao:
      'plan §12 — sem amostras suficientes, o gatilho de duração usa esta fração do timeout efetivo.',
  },
  {
    chave: 'gatilho_agregacao_min_ocorrencias',
    valor: 3,
    descricao:
      'plan §10.27 — a partir daqui, o mesmo gatilho repetido no run vira banner e notificação: ' +
      'indica skill ambígua, não alunos errando igual.',
  },
  {
    chave: 'disco_alerta_gb',
    valor: 15,
    descricao: 'plan §10.19, §12 — janitor alerta abaixo deste espaço livre.',
  },
  {
    chave: 'disco_pausa_gb',
    valor: 5,
    descricao: 'plan §10.19, §12 — abaixo deste espaço livre, pausa global automática.',
  },
  {
    chave: 'retencao_job_dir_dias',
    valor: 14,
    descricao:
      'plan §11 — job dir referenciado por uma correção (inclusive `falhou` e `timeout`) vive este ' +
      'prazo. Job dir órfão não espera: o janitor remove no próximo ciclo.',
  },
  {
    chave: 'retencao_backup_dias',
    valor: 14,
    descricao: 'plan §12 — quantos `pg_dump` diários ficam em ./backups.',
  },
  {
    chave: 'retomada_intervalos_min',
    valor: [5, 15, 30, 60],
    descricao:
      'plan §10.10 — intervalos, em minutos, da retomada escalonada depois de pausa automática. ' +
      'O índice usado é `pausa_global.tentativas`; esgotada a lista, vale o último.',
  },
  {
    chave: 'timeout_job_padrao_s',
    // Único lugar onde 1500 aparece. O timeout efetivo é sempre
    // `skills_map.timeout_s ?? config.timeout_job_padrao_s` — nenhuma fase fixa o literal no código.
    valor: 1500,
    descricao:
      'plan §5, §10.9 — timeout padrão do job (25 min). O override por desafio é ' +
      '`skills_map.timeout_s`; o timeout efetivo é o override quando existe, senão este valor.',
  },
];

/**
 * Semeia os defaults sem sobrescrever nada. Chave já existente é deixada como está: um valor
 * calibrado na operação (F7) não pode ser revertido por alguém rodando `pnpm db:seed` de novo.
 */
export async function semearConfig(prisma: PrismaClient): Promise<{ criadas: number }> {
  const { count } = await prisma.config.createMany({
    data: [...CONFIG_PADRAO],
    skipDuplicates: true,
  });

  return { criadas: count };
}
