// UC-FAM: ver um membro (FAM_MEMBER).
import type { FamiliesDeps } from "./ports.js";
import { requireMemberRecord, requireMembership } from "./membership.js";
import { toMemberView, type MemberView } from "./member-view.js";

export function createGetMemberUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function getMember(userId: string, familyId: string, memberId: string): Promise<MemberView> {
    const actor = await requireMembership(deps, deps.db, familyId, userId);
    const target = await requireMemberRecord(deps, deps.db, familyId, memberId);
    const guardianships = target.isDependent
      ? await deps.guardianshipsRepo.listByDependent(deps.db, familyId, target.id)
      : [];
    return toMemberView(target, deps.clock.now(), actor.id, guardianships);
  };
}
