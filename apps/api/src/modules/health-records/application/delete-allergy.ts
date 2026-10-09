// openapi.yaml `deleteAllergy`: "Autorização: WRITE(ALLERGIES)".
import { NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { ActorIdentity, HealthRecordsDeps, RequestContext } from "./ports.js";

export function createDeleteAllergyUseCase<Trx>(deps: HealthRecordsDeps<Trx>) {
  return async function deleteAllergy(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    allergyId: string,
    context: RequestContext,
  ): Promise<void> {
    return deps.withTransaction(async (trx) => {
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "DELETE",
        subjectMemberId: memberId,
        category: "ALLERGIES",
      });

      const existing = await deps.allergiesRepo.findById(trx, familyId, memberId, allergyId);
      if (!existing) {
        throw new NotFoundError({ detail: "Alergia não encontrada." });
      }

      await deps.allergiesRepo.delete(trx, familyId, memberId, allergyId);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: actor.userId,
        action: "ALLERGY_DELETE",
        resourceType: "Allergy",
        resourceId: allergyId,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
  };
}
