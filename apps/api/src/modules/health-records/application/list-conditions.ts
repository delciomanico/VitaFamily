// openapi.yaml `listConditions`: "Autorização: READ(CONDITIONS)".
import type { MedicalCondition } from "../domain/medical-condition.js";
import type { ActorIdentity, HealthRecordsDeps, RequestContext } from "./ports.js";
import { auditViewIfNotSelf } from "./support.js";

export function createListConditionsUseCase<Trx>(deps: HealthRecordsDeps<Trx>) {
  return async function listConditions(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    context: RequestContext,
  ): Promise<MedicalCondition[]> {
    return deps.withTransaction(async (trx) => {
      const ctx = await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "READ",
        subjectMemberId: memberId,
        category: "CONDITIONS",
      });
      const conditions = await deps.conditionsRepo.listByMember(trx, familyId, memberId);
      await auditViewIfNotSelf(deps, trx, ctx, { userId: actor.userId, familyId, memberId, resourceType: "Condition", context });
      return conditions;
    });
  };
}
