// Leitura de CSV conforme RFC 4180. Existe porque nome de desafio na plataforma contém vírgula
// ("Do compose ao cluster: Docker, Kubernetes e Terraform") e o casamento com o bloco colado no
// intake é literal — trocar a vírgula por outro caractere garantiria que o par nunca casa. Então
// quem muda é o formato do arquivo: valor com vírgula vai entre aspas, aspas internas são dobradas.
//
// Mora em `packages/shared` porque tem dois consumidores que precisam ler igual: o seed do
// `skills_map` (F1) e o guard `tests/skills-map.test.ts` (F0), que valida o arquivo antes de
// qualquer banco existir. Duas cópias do parser seriam duas definições do que é o arquivo.

/** Separa uma linha em campos. Um `split(',')` ingênuo quebraria os valores entre aspas. */
export function parseLinhaCsv(linha: string): string[] {
  const campos: string[] = [];
  let atual = '';
  let dentroDeAspas = false;

  for (let i = 0; i < linha.length; i++) {
    const caractere = linha[i];
    if (dentroDeAspas) {
      if (caractere === '"' && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else if (caractere === '"') {
        dentroDeAspas = false;
      } else {
        atual += caractere;
      }
    } else if (caractere === '"') {
      dentroDeAspas = true;
    } else if (caractere === ',') {
      campos.push(atual);
      atual = '';
    } else {
      atual += caractere;
    }
  }

  campos.push(atual);
  return campos;
}

/**
 * Aspas que abrem e não fecham na mesma linha. Recusar é melhor do que adivinhar: o parser acima
 * engoliria o resto da linha dentro do último campo, e o erro só apareceria como par que não casa.
 */
export function temAspasDesbalanceadas(linha: string): boolean {
  return (linha.match(/"/g)?.length ?? 0) % 2 !== 0;
}

/**
 * Quebra o conteúdo em linhas, tolerando o que um editor de planilha no Windows deixa para trás:
 * BOM no começo e CRLF no fim de cada linha. Linha vazia no meio do arquivo **é preservada** — ela
 * é um registro malformado e quem lê tem que poder recusá-la pelo número, não silenciá-la aqui.
 */
export function linhasDoCsv(conteudo: string): string[] {
  // BOM escapado (U+FEFF) de propósito: escrito literal seria um caractere invisível no meio do
  // código — o lint acusa, e quem lê não enxerga o que está ali.
  const semBom = conteudo.startsWith('\uFEFF') ? conteudo.slice(1) : conteudo;
  const linhas = semBom.replace(/\r\n?/g, '\n').split('\n');

  while (linhas.length > 0 && linhas[linhas.length - 1] === '') linhas.pop();

  return linhas;
}
