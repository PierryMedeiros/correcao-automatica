import type { PrismaClient } from '../../src/db/client.js';
import type { RegistroSkillsMap } from './csv.js';

export interface SumarioSkillsMap {
  inseridas: number;
  atualizadas: number;
  desativadas: number;
}

function chave(par: { projeto: string; fase: string }): string {
  return JSON.stringify([par.projeto, par.fase]);
}

/**
 * Carrega o `skills_map` a partir dos registros já validados. Idempotente: o upsert é por
 * `(projeto, fase)`, então rodar duas vezes não duplica nada.
 *
 * Par que sumiu do CSV vira `ativo = false`, nunca `DELETE` (D7 da F1): submissões antigas apontam
 * para o desafio pelo par, e o histórico não pode perder a referência. Par que volta ao CSV volta a
 * `ativo = true` — o arquivo é a fonte da verdade do mapa (§5, §17.1), então estar nele é estar ativo.
 *
 * Tudo em uma transação: o motivo de validar antes de escrever (D6) é não deixar o mapa meio
 * carregado, e um erro de banco no meio do laço deixaria exatamente isso.
 */
export async function semearSkillsMap(
  prisma: PrismaClient,
  registros: RegistroSkillsMap[],
): Promise<SumarioSkillsMap> {
  return prisma.$transaction(async (tx) => {
    const existentes = await tx.skillsMap.findMany({ select: { projeto: true, fase: true } });
    const jaExistia = new Set(existentes.map(chave));

    for (const registro of registros) {
      const { projeto, fase, ...campos } = registro;
      await tx.skillsMap.upsert({
        where: { projeto_fase: { projeto, fase } },
        create: { projeto, fase, ...campos },
        update: { ...campos, ativo: true },
      });
    }

    const noCsv = new Set(registros.map(chave));
    const sumiram = existentes.filter((par) => !noCsv.has(chave(par)));

    const desativadas =
      sumiram.length === 0
        ? 0
        : (
            await tx.skillsMap.updateMany({
              where: { ativo: true, OR: sumiram.map(({ projeto, fase }) => ({ projeto, fase })) },
              data: { ativo: false },
            })
          ).count;

    const atualizadas = registros.filter((registro) => jaExistia.has(chave(registro))).length;

    return { inseridas: registros.length - atualizadas, atualizadas, desativadas };
  });
}
