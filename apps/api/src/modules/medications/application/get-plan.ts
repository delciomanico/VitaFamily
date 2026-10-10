// openapi.yaml `getMedicationPlan`: "Autorização: READ(MEDICATION)."
import { NotFoundError } from "../../../platform/errors/index.js";
import type { MedicationPlan } from "../domain/medication-plan.js";
import { auditViewIfNotSelf } from "./support.js";
import type { ActorIdentity, MedicationsDeps, RequestContext } from "./ports.js";

export function createGetPlanUseCase<Trx>(deps: MedicationsDeps<Trx>) {
  return async function getPlan(actor: ActorIdentity, familyId: string, memberId: string, planId: string, context: RequestContext): Promise<MedicationPlan> {
    return deps.withTransaction(async (trx) => {
      const ctx = await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "READ",
        subjectMemberId: memberId,
        category: "MEDICATION",
      });

      const plan = await deps.plansRepo.findById(trx, familyId, memberId, planId);
      if (!plan) {
        throw new NotFoundError({ detail: "Plano não encontrado." });
      }
      await auditViewIfNotSelf(deps, trx, ctx, { userId: actor.userId, familyId, memberId, resourceType: "MedicationPlan", context });
      return plan;
    });
  };
}
