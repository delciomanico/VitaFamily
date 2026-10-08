// UC-MEM-04: revogar convite pendente (FAM_ADMIN; ou tutor, se for convite de conta do seu
// dependente, authorization.md §4).
import { ForbiddenError, NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { FamiliesDeps, RequestContext } from "./ports.js";
import { requireMembership } from "./membership.js";

export function createRevokeInvitationUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function revokeInvitation(
    userId: string,
    familyId: string,
    invitationId: string,
    context: RequestContext,
  ): Promise<void> {
    await deps.withTransaction(async (trx) => {
      const actor = await requireMembership(deps, trx, familyId, userId);
      const invitation = await deps.invitationsRepo.findById(trx, familyId, invitationId);
      if (invitation?.status !== "PENDING") {
        throw new NotFoundError({ detail: "Convite não encontrado." });
      }

      if (actor.role !== "FAMILY_ADMIN") {
        if (invitation.type !== "DEPENDENT_ACCOUNT" || !invitation.memberId) {
          throw new ForbiddenError({ detail: "Requer Family Admin." });
        }
        const guardianship = await deps.guardianshipsRepo.find(trx, familyId, invitation.memberId, actor.id);
        if (!guardianship) {
          throw new ForbiddenError({ detail: "Requer Family Admin ou tutor do dependente." });
        }
      }

      await deps.invitationsRepo.updateStatus(trx, invitation.id, "REVOKED");

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: userId,
        action: "INVITATION_REVOKE",
        resourceType: "Invitation",
        resourceId: invitation.id,
        familyId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
  };
}
