import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ComposeInvalidoError,
  analisarCompose,
  gerarOverrideDoCompose,
  gerarOverrideNoports,
} from './override-noports.js';

// O contrato que este arquivo trava é o do §8/§10.14/§10.15: depois do override, nenhum serviço do
// aluno publica porta no host nem carrega nome fixo, e a stack inteira nasce na network do job.
// Quebrar qualquer um dos três não dá erro na hora — dá colisão de porta no segundo job paralelo,
// ou um agente que não alcança o serviço que ele mesmo subiu.

const NETWORK = 'fc-job-123_net';

const composeDoSpikeS3 = readFileSync(
  fileURLToPath(new URL('../../../../scripts/spikes/s3/compose-aluno.yml', import.meta.url)),
  'utf8',
);

describe('analisarCompose', () => {
  it('lê os serviços e quem trazia container_name fixo no compose do spike S3', () => {
    const analise = analisarCompose(composeDoSpikeS3);

    expect(analise.servicos).toEqual(['app', 'db', 'probe']);
    expect(analise.servicosComContainerNameFixo).toEqual(['app', 'db', 'probe']);
  });

  it('inclui a network default mesmo quando o compose não declara nenhuma', () => {
    const analise = analisarCompose(`services:\n  app:\n    image: nginx\n`);

    expect(analise.networks).toEqual(['default']);
  });

  it('reúne as networks declaradas no topo e as referenciadas pelos serviços', () => {
    const analise = analisarCompose(`
services:
  api:
    image: node
    networks: [backend]
  web:
    image: nginx
    networks:
      frontend: {}
networks:
  backend: {}
  frontend: {}
  sem_uso: {}
`);

    expect(analise.networks.sort()).toEqual(['backend', 'default', 'frontend', 'sem_uso']);
  });

  it('não marca container_name em serviço que não declara nenhum', () => {
    const analise = analisarCompose(`services:\n  app:\n    image: nginx\n  db:\n    image: pg\n`);

    expect(analise.servicosComContainerNameFixo).toEqual([]);
  });

  it('recusa compose sem serviço nenhum', () => {
    expect(() => analisarCompose('networks:\n  default: {}\n')).toThrow(ComposeInvalidoError);
  });

  it('recusa YAML que não parseia', () => {
    expect(() => analisarCompose('services:\n  - [inválido\n')).toThrow(ComposeInvalidoError);
  });

  // O nome vem do repo do aluno e é interpolado no YAML que nós geramos.
  it('recusa nome de serviço que viraria injeção de chave no override', () => {
    expect(() =>
      analisarCompose(`services:\n  ? "app:\\n    privileged: true"\n  : {image: x}\n`),
    ).toThrow(ComposeInvalidoError);
  });
});

describe('gerarOverrideNoports', () => {
  it('apaga ports e container_name de todos os serviços, com !reset', () => {
    const { override, analise } = gerarOverrideDoCompose(composeDoSpikeS3, NETWORK);

    for (const servico of analise.servicos) {
      expect(override).toContain(
        `  ${servico}:\n    ports: !reset []\n    container_name: !reset null`,
      );
    }
  });

  // `ports: []` sem a tag CONCATENA com a lista do arquivo base (achado do S3): o override
  // pareceria certo e a porta continuaria publicada.
  it('nunca emite ports ou container_name sem a tag !reset', () => {
    const { override } = gerarOverrideDoCompose(composeDoSpikeS3, NETWORK);

    const semReset = override
      .split('\n')
      .filter((linha) => /^\s+(ports|container_name):/.test(linha) && !linha.includes('!reset'));
    expect(semReset).toEqual([]);
  });

  it('aponta a network default para a network externa do job', () => {
    const { override } = gerarOverrideDoCompose(`services:\n  app:\n    image: nginx\n`, NETWORK);

    expect(override).toContain(`networks:\n  default:\n    name: ${NETWORK}\n    external: true`);
  });

  it('manda todas as networks do aluno para a mesma network do job', () => {
    const compose = `
services:
  api:
    image: node
    networks: [backend]
networks:
  backend: {}
`;
    const { override } = gerarOverrideDoCompose(compose, NETWORK);

    expect(override).toContain(`  backend:\n    name: ${NETWORK}\n    external: true`);
    expect(override).toContain(`  default:\n    name: ${NETWORK}\n    external: true`);
  });

  it('não inventa serviço nem copia chave alheia do compose base', () => {
    const compose = `
services:
  app:
    image: nginx:1.27
    environment:
      SENHA: segredo
    volumes:
      - ./dados:/dados
    ports: ['8080:8080']
`;
    const { override } = gerarOverrideDoCompose(compose, NETWORK);

    expect(override).not.toContain('image');
    expect(override).not.toContain('environment');
    expect(override).not.toContain('volumes');
    expect(override).not.toContain('segredo');
    expect(override.match(/^ {2}\w[\w.-]*:$/gm)).toEqual(['  app:', '  default:']);
  });

  it('inclui serviço que não publica porta nenhuma, para o override não depender do que o aluno escreveu', () => {
    const { override } = gerarOverrideDoCompose(
      `services:\n  app:\n    image: nginx\n  worker:\n    image: node\n`,
      NETWORK,
    );

    expect(override).toContain('  worker:\n    ports: !reset []');
  });

  it('é determinístico: mesma entrada, mesma saída byte a byte', () => {
    const primeiro = gerarOverrideDoCompose(composeDoSpikeS3, NETWORK).override;
    const segundo = gerarOverrideDoCompose(composeDoSpikeS3, NETWORK).override;

    expect(segundo).toBe(primeiro);
  });

  it('recusa nome de network do job fora do formato do Compose', () => {
    const analise = analisarCompose(`services:\n  app:\n    image: nginx\n`);

    expect(() => gerarOverrideNoports(analise, 'fc-job-1_net\nprivileged: true')).toThrow(
      ComposeInvalidoError,
    );
  });
});
