// openapi.yaml `listAllergies`: "Autorização: READ(ALLERGIES)".
import type { Allergy } from "../domain/allergy.js";
import type { ActorIdentity, HealthRecordsDeps, RequestContext } from "./ports.js";
import { auditViewIfNotSelf } from "./support.js";

export function createListAllergiesUseCase<Trx>(deps: HealthRecordsDeps<Trx>) {
  return async function listAllergies(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    context: RequestContext,
  ): Promise<Allergy[]> {
    return deps.withTransaction(async (trx) => {
      const ctx = await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "READ",
        subjectMemberId: memberId,
        category: "ALLERGIES",
      });
      const allergies = await deps.allergiesRepo.listByMember(trx, familyId, memberId);
      await auditViewIfNotSelf(deps, trx, ctx, { userId: actor.userId, familyId, memberId, resourceType: "Allergy", context });
      return allergies;
    });
  };
}
