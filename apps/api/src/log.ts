import { pino, type DestinationStream, type Logger } from 'pino';

// Log estruturado do §12. Toda linha de job carrega `job_id` e `submissao_id`, e a forma de
// garantir isso é o child logger: quem cria o contexto uma vez não esquece de repetir o campo em
// cada chamada. Log sem o id do job é log que não serve para investigar correção nenhuma.
//
// `redact` é cinto e suspensório da regra dura 5: o token nunca entra em variável nossa (o Docker
// o copia do ambiente do processo, ver `env.ts`), mas se algum dia alguém logar um objeto de
// ambiente inteiro, o valor sai censurado em vez de ir parar no arquivo de log.

const SEGREDOS = [
  'CLAUDE_CODE_OAUTH_TOKEN',
  '*.CLAUDE_CODE_OAUTH_TOKEN',
  'token',
  '*.token',
  'DATABASE_URL',
  '*.DATABASE_URL',
];

export function criarLogger(destino?: DestinationStream): Logger {
  return pino(
    {
      level: process.env['LOG_LEVEL'] ?? 'info',
      redact: { paths: SEGREDOS, censor: '[redigido]' },
      base: undefined,
    },
    destino,
  );
}

export const logger: Logger = criarLogger();

export type { Logger };
