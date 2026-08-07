// Vocabulário do domínio (plan §5). Cada enum é uma tupla `as const` mais o tipo derivado dela:
// a lista existe em runtime (o seed valida contra ela, o teste compara com o enum do Postgres) e
// o tipo sai da lista, então acrescentar valor em um lugar não deixa o outro para trás.
//
// `packages/shared` é o dono destes tipos (CLAUDE.md): `apps/api` e `apps/web` importam daqui e
// nunca redeclaram. O schema Prisma replica os mesmos valores no enum nativo do Postgres, e
// `apps/api/tests/db/schema.test.ts` quebra se os dois divergirem — o front não pode depender do
// client Prisma (D4 da F1), então a replicação é conferida por teste, não evitada por importação.

export const ORIGENS_SUBMISSAO = ['manual', 'fc_platform'] as const;
export type OrigemSubmissao = (typeof ORIGENS_SUBMISSAO)[number];

export const STATUS_CORRECAO = [
  'rodando',
  'concluida',
  'falhou',
  'timeout',
  'nao_executada',
] as const;
export type StatusCorrecao = (typeof STATUS_CORRECAO)[number];

export const VEREDITOS = [
  'aprovado',
  'aprovado_com_observacao',
  'reprovado',
  'inconclusivo',
] as const;
export type Veredito = (typeof VEREDITOS)[number];

export const MODOS_AVALIACAO = ['execucao', 'estatica'] as const;
export type ModoAvaliacao = (typeof MODOS_AVALIACAO)[number];

export const POLITICAS_REVISAO = ['todas', 'so_reprovadas', 'nenhuma'] as const;
export type PoliticaRevisao = (typeof POLITICAS_REVISAO)[number];

export const STATUS_RUN = ['ativo', 'pausado', 'finalizado', 'cancelado'] as const;
export type StatusRun = (typeof STATUS_RUN)[number];
