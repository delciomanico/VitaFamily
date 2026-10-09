// openapi.yaml `deleteCondition`: "Autorização: WRITE(CONDITIONS)".
import { NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { ActorIdentity, HealthRecordsDeps, RequestContext } from "./ports.js";

export function createDeleteConditionUseCase<Trx>(deps: HealthRecordsDeps<Trx>) {
  return async function deleteCondition(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    conditionId: string,
    context: RequestContext,
  ): Promise<void> {
    return deps.withTransaction(async (trx) => {
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "DELETE",
        subjectMemberId: memberId,
        category: "CONDITIONS",
      });

      const existing = await deps.conditionsRepo.findById(trx, familyId, memberId, conditionId);
      if (!existing) {
        throw new NotFoundError({ detail: "Condição não encontrada." });
      }

      await deps.conditionsRepo.delete(trx, familyId, memberId, conditionId);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: actor.userId,
        action: "CONDITION_DELETE",
        resourceType: "Condition",
        resourceId: conditionId,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
  };
}
