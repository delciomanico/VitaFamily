// UC-FAM: listar tutores de um dependente (FAM_MEMBER).
import type { Guardianship } from "../domain/guardianship.js";
import type { FamiliesDeps } from "./ports.js";
import { requireMemberRecord, requireMembership } from "./membership.js";

export function createListGuardiansUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function listGuardians(userId: string, familyId: string, memberId: string): Promise<Guardianship[]> {
    await requireMembership(deps, deps.db, familyId, userId);
    const target = await requireMemberRecord(deps, deps.db, familyId, memberId);
    return deps.guardianshipsRepo.listByDependent(deps.db, familyId, target.id);
  };
}
