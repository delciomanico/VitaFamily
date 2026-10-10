// Fuso efetivo de um membro (Q8/DM6, BR-MED-08, `03-use-cases/medications.md` UC-MED-01): o do
// titular com conta, ou o do tutor principal quando o membro não tem conta própria — consumido por
// `medications` (via `access`, que já depende de `families`, modules.md §2) para gerar/recalcular
// ocorrências de toma no fuso correto (FR-MED-03). Operação crua, sem autorização própria (quem
// chama — `access`/`medications` — já decidiu o acesso antes); mesmo critério de
// `getBloodType`/`findMemberById` já expostos a outros módulos.
import { NotFoundError } from "../../../platform/errors/index.js";
import type { FamiliesDeps } from "./ports.js";

export function createGetEffectiveTimezoneUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function getEffectiveTimezone(trx: Trx, familyId: string, memberId: string): Promise<string> {
    const member = await deps.membersRepo.findById(trx, familyId, memberId);
    if (!member) {
      throw new NotFoundError({ detail: "Membro não encontrado." });
    }

    if (member.userId) {
      const user = await deps.usersPort.byId(trx, member.userId);
      if (!user) {
        throw new NotFoundError({ detail: "Conta não encontrada." });
      }
      return user.timezone;
    }

    // Sem conta (dependente, N1/BR-MEM-03): usa-se o fuso do tutor principal (Q8); na ausência
    // (não deveria acontecer, BR-MEM-06) cai-se para o primeiro tutor disponível em vez de falhar.
    const guardianships = await deps.guardianshipsRepo.listByDependent(trx, familyId, memberId);
    const primary = guardianships.find((g) => g.isPrimary) ?? guardianships[0];
    if (!primary) {
      throw new NotFoundError({ detail: "Sem tutor para calcular o fuso horário." });
    }
    const guardian = await deps.membersRepo.findById(trx, familyId, primary.guardianId);
    if (!guardian?.userId) {
      throw new NotFoundError({ detail: "Tutor sem conta." });
    }
    const guardianUser = await deps.usersPort.byId(trx, guardian.userId);
    if (!guardianUser) {
      throw new NotFoundError({ detail: "Conta do tutor não encontrada." });
    }
    return guardianUser.timezone;
  };
}
