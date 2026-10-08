// UC-FAM-06/R2: eliminar família — só se o actor for o único membro.
import { DomainError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { FamiliesDeps, RequestContext } from "./ports.js";
import { requireAdmin, requireMembership } from "./membership.js";

export function createDeleteFamilyUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function deleteFamily(userId: string, familyId: string, context: RequestContext): Promise<void> {
    await deps.withTransaction(async (trx) => {
      const member = await requireMembership(deps, trx, familyId, userId);
      requireAdmin(member);

      const total = await deps.membersRepo.countByFamily(trx, familyId);
      if (total > 1) {
        throw new DomainError("FAMILY_NOT_EMPTY", { detail: "A família ainda tem outros membros." });
      }

      await deps.familiesRepo.delete(trx, familyId);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: userId,
        action: "FAMILY_DELETE",
        resourceType: "Family",
        resourceId: familyId,
        familyId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
  };
}
