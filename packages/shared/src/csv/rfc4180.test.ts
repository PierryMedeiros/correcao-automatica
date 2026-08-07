import { describe, expect, it } from 'vitest';
import { linhasDoCsv, parseLinhaCsv, temAspasDesbalanceadas } from './rfc4180.js';

describe('parseLinhaCsv (RFC 4180)', () => {
  it('separa campos simples', () => {
    expect(parseLinhaCsv('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('preserva a vírgula que está dentro de aspas', () => {
    expect(parseLinhaCsv('MBA,"Docker, Kubernetes e Terraform",corrige-x')).toEqual([
      'MBA',
      'Docker, Kubernetes e Terraform',
      'corrige-x',
    ]);
  });

  it('desdobra aspas duplicadas dentro do valor', () => {
    expect(parseLinhaCsv('a,"diz ""oi"" aqui",c')).toEqual(['a', 'diz "oi" aqui', 'c']);
  });

  it('mantém campos vazios', () => {
    expect(parseLinhaCsv('a,,c,')).toEqual(['a', '', 'c', '']);
  });
});

describe('temAspasDesbalanceadas', () => {
  it('aceita linha com aspas que fecham', () => {
    expect(temAspasDesbalanceadas('a,"b,c",d')).toBe(false);
  });

  it('acusa aspas abertas que não fecham', () => {
    expect(temAspasDesbalanceadas('a,"b,c,d')).toBe(true);
  });
});

describe('linhasDoCsv', () => {
  it('sobrevive ao que o Excel deixa: BOM no começo e CRLF no fim das linhas', () => {
    expect(linhasDoCsv('\uFEFFa,b\r\nc,d\r\n')).toEqual(['a,b', 'c,d']);
  });

  it('descarta só a quebra final, não linha vazia no meio', () => {
    expect(linhasDoCsv('a\n\nb\n\n')).toEqual(['a', '', 'b']);
  });
});
