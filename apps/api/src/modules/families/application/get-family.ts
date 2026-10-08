// UC-FAM: ver família (FAM_MEMBER). NOT_FOUND se o actor não for membro (sem enumeração).
import { NotFoundError } from "../../../platform/errors/index.js";
import type { FamiliesDeps } from "./ports.js";
import { requireMembership } from "./membership.js";
import { toFamilyView, type FamilyView } from "./family-view.js";

export function createGetFamilyUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function getFamily(userId: string, familyId: string): Promise<FamilyView> {
    const member = await requireMembership(deps, deps.db, familyId, userId);
    const family = await deps.familiesRepo.findById(deps.db, familyId);
    if (!family) {
      throw new NotFoundError({ detail: "Família não encontrada." });
    }
    // member.role existe sempre aqui: requireMembership só devolve FamilyMember com conta ligada
    // (CHECK role IS NULL OR user_id IS NOT NULL — role nunca é nulo para quem tem conta no MVP).
    return toFamilyView(family, member.role ?? "FAMILY_MEMBER");
  };
}
