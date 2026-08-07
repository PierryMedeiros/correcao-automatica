import { afterAll, beforeEach } from 'vitest';
import { desconectarPrismaTeste, limparBanco } from './setup-db.js';

// `setupFiles` do projeto de banco: todo teste começa com as tabelas vazias, sem depender da ordem
// de execução nem de quem rodou antes. Os arquivos de banco rodam em uma única thread (vitest.config),
// senão um truncate apagaria a fixture de outro arquivo no meio da asserção.
beforeEach(limparBanco);

afterAll(desconectarPrismaTeste);
