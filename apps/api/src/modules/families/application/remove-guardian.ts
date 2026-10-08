// BR-MEM-07/P8: remover tutor (FAM_ADMIN, ou o próprio dependente se adulto com conta). O último
// tutor de um dependente nunca pode ser removido; se o tutor removido era o principal, outro tutor
// remanescente é promovido automaticamente (BR-MEM-06: há sempre exatamente um principal).
import { DomainError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { FamiliesDeps, RequestContext } from "./ports.js";
import { assertCanManageGuardians, requireMemberRecord, requireMembership } from "./membership.js";

export function createRemoveGuardianUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function removeGuardian(
    userId: string,
    familyId: string,
    memberId: string,
    guardianMemberId: string,
    context: RequestContext,
  ): Promise<void> {
    await deps.withTransaction(async (trx) => {
      const actor = await requireMembership(deps, trx, familyId, userId);
      const target = await requireMemberRecord(deps, trx, familyId, memberId);
      const now = deps.clock.now();
      assertCanManageGuardians(actor, target, now);

      const guardianship = await deps.guardianshipsRepo.find(trx, familyId, target.id, guardianMemberId);
      if (!guardianship) {
        throw new DomainError("NOT_FOUND", { detail: "Tutor não encontrado." });
      }

      const all = await deps.guardianshipsRepo.listByDependent(trx, familyId, target.id);
      if (all.length <= 1) {
        throw new DomainError("LAST_GUARDIAN", { detail: "O dependente ficaria sem tutor." });
      }

      await deps.guardianshipsRepo.delete(trx, familyId, target.id, guardianMemberId);

      if (guardianship.isPrimary) {
        const remaining = all.filter((g) => g.guardianId !== guardianMemberId);
        const nextPrimary = remaining[0];
        if (nextPrimary) {
          await deps.guardianshipsRepo.setPrimary(trx, familyId, target.id, nextPrimary.guardianId);
        }
      }

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: userId,
        action: "GUARDIAN_REMOVE",
        resourceType: "Guardianship",
        familyId,
        subjectMemberId: target.id,
        result: "SUCCESS",
        requestId: context.requestId,
        metadata: { guardianId: guardianMemberId },
        ...auditContextFields(context),
      });
    });
  };
}
