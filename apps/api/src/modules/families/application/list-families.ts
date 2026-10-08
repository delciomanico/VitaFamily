// UC-FAM-02/FR-FAM-02: listar as famílias do utilizador e o papel em cada uma.
import type { FamiliesDeps } from "./ports.js";
import { toFamilyView, type FamilyView } from "./family-view.js";

export function createListFamiliesUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function listFamilies(userId: string): Promise<FamilyView[]> {
    const memberships = await deps.membersRepo.listFamilyIdsForUser(deps.db, userId);
    const views: FamilyView[] = [];
    for (const membership of memberships) {
      const family = await deps.familiesRepo.findById(deps.db, membership.familyId);
      if (family) {
        views.push(toFamilyView(family, membership.role));
      }
    }
    return views;
  };
}
