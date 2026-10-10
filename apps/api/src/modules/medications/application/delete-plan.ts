// openapi.yaml `deleteMedicationPlan`: "Autorização: WRITE(MEDICATION). Aconselhar terminar em vez
// de eliminar." Apaga o plano e o seu histórico de tomas (schema.md: `dose_occurrences.plan_id FK
// CASCADE`).
import { auditContextFields } from "../../audit/index.js";
import { NotFoundError } from "../../../platform/errors/index.js";
import type { ActorIdentity, MedicationsDeps, RequestContext } from "./ports.js";

export function createDeletePlanUseCase<Trx>(deps: MedicationsDeps<Trx>) {
  return async function deletePlan(actor: ActorIdentity, familyId: string, memberId: string, planId: string, context: RequestContext): Promise<void> {
    return deps.withTransaction(async (trx) => {
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "DELETE",
        subjectMemberId: memberId,
        category: "MEDICATION",
      });

      const existing = await deps.plansRepo.findById(trx, familyId, memberId, planId);
      if (!existing) {
        throw new NotFoundError({ detail: "Plano não encontrado." });
      }

      await deps.plansRepo.delete(trx, familyId, memberId, planId);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: actor.userId,
        action: "PLAN_DELETE",
        resourceType: "MedicationPlan",
        resourceId: planId,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
  };
}
