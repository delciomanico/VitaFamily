// UC-MEM-04 (listar): convites pendentes e passados da família (FAM_ADMIN).
import type { FamiliesDeps } from "./ports.js";
import { requireAdmin, requireMembership } from "./membership.js";
import { toInvitationView, type InvitationView } from "./invitation-view.js";

export function createListInvitationsUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function listInvitations(userId: string, familyId: string): Promise<InvitationView[]> {
    const actor = await requireMembership(deps, deps.db, familyId, userId);
    requireAdmin(actor);
    const invitations = await deps.invitationsRepo.listByFamily(deps.db, familyId);
    return invitations.map(toInvitationView);
  };
}
