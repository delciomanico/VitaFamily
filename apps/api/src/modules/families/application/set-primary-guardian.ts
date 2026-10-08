// BR-MEM-06: definir o tutor principal (FAM_ADMIN, ou o próprio dependente se adulto com conta).
import { DomainError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { FamiliesDeps, RequestContext } from "./ports.js";
import { assertCanManageGuardians, requireMemberRecord, requireMembership } from "./membership.js";

export function createSetPrimaryGuardianUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function setPrimaryGuardian(
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
        throw new DomainError("GUARDIAN_INVALID", { detail: "Tutor inválido para este dependente." });
      }

      await deps.guardianshipsRepo.setPrimary(trx, familyId, target.id, guardianMemberId);

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: userId,
        action: "GUARDIAN_PRIMARY_CHANGE",
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
