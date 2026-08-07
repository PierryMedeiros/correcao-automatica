// Módulo titular da máquina de estados da submissão (plan §6). `StatusSubmissao`,
// `STATUS_TERMINAIS` e `estaAtiva` nascem aqui na F1 e **crescem aqui**: a F4 traz para este
// arquivo a tabela de transições do §6 e `podeTransicionar()`, reusando o que já existe.
// Fase seguinte não redeclara o enum em outro caminho nem cria uma segunda função de "ativo"
// com outro nome — dois caminhos para a mesma regra é a duplicação que o CLAUDE.md proíbe.

export const STATUS_SUBMISSAO = [
  'recebida',
  'validando',
  'na_fila',
  'corrigindo',
  'aguardando_revisao',
  'pronta_envio',
  'enviada',
  'link_invalido',
  'sem_skill',
  'erro',
  'cancelada',
  'substituida',
] as const;
export type StatusSubmissao = (typeof STATUS_SUBMISSAO)[number];

// Os "terminais de fato" do §6 — os únicos estados em que a submissão sai de cena.
export const STATUS_TERMINAIS = ['enviada', 'cancelada', 'substituida'] as const;
export type StatusTerminal = (typeof STATUS_TERMINAIS)[number];

// "Ativo" é o complemento dos terminais, nunca uma segunda lista (plan §5, Apêndice B v1.3 item 1).
// Definir assim é deliberado: estado novo entra como ativo automaticamente e as duas listas não têm
// como divergir. A consequência assumida é que `link_invalido`, `sem_skill` e `erro` são ativos —
// então o reenvio do aluno com o link corrigido **substitui** a submissão travada em vez de abrir uma
// segunda linha (§10.5). O índice único parcial de `submissoes` escreve o mesmo predicado em SQL.
export function estaAtiva(status: StatusSubmissao): boolean {
  return !(STATUS_TERMINAIS as readonly string[]).includes(status);
}
