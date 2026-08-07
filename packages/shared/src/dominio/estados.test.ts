import { describe, expect, it } from 'vitest';
import { estaAtiva, STATUS_SUBMISSAO, STATUS_TERMINAIS, type StatusSubmissao } from './estados.js';

describe('estados da submissão (plan §6)', () => {
  it('tem exatamente os 12 estados do §6 — estado novo exige mudar o plano antes (regra dura 3)', () => {
    expect([...STATUS_SUBMISSAO]).toEqual([
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
    ]);
  });

  it('não repete estado', () => {
    expect(new Set(STATUS_SUBMISSAO).size).toBe(STATUS_SUBMISSAO.length);
  });

  it('só reconhece como terminal de fato enviada, cancelada e substituida', () => {
    expect([...STATUS_TERMINAIS]).toEqual(['enviada', 'cancelada', 'substituida']);
  });
});

describe('estaAtiva — "ativo" é o complemento dos terminais (plan §5)', () => {
  it.each(STATUS_TERMINAIS)('%s não é ativo', (status) => {
    expect(estaAtiva(status)).toBe(false);
  });

  // A consequência assumida no §5: quem está travado esperando ação continua ocupando a vaga do
  // aluno naquele desafio, então o reenvio substitui em vez de criar uma segunda submissão (§10.5).
  it.each(['link_invalido', 'sem_skill', 'erro'] as const)(
    '%s é ativo, mesmo parecendo fim de linha',
    (status) => {
      expect(estaAtiva(status)).toBe(true);
    },
  );

  it('classifica os 12 estados sem sobra: ativo é exatamente o que não é terminal', () => {
    const ativos = STATUS_SUBMISSAO.filter(estaAtiva);
    const terminais = STATUS_SUBMISSAO.filter((status) => !estaAtiva(status));

    expect(ativos.length + terminais.length).toBe(12);
    expect([...terminais].sort()).toEqual([...STATUS_TERMINAIS].sort());
  });

  it('todo estado terminal está entre os estados declarados', () => {
    const declarados: readonly StatusSubmissao[] = STATUS_SUBMISSAO;
    expect(STATUS_TERMINAIS.every((status) => declarados.includes(status))).toBe(true);
  });
});
