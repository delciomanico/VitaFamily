// openapi.yaml `listMedicationPlans`: "Autorização: READ(MEDICATION). Dependente com conta lê (N2)."
import { parsePageParams } from "../../../platform/page/index.js";
import type { MedicationPlan, PlanStatus } from "../domain/medication-plan.js";
import { auditViewIfNotSelf } from "./support.js";
import type { ActorIdentity, CursorPage, MedicationsDeps, RequestContext } from "./ports.js";

export interface ListMedicationPlansQuery {
  status?: string;
  limit?: string;
  cursor?: string;
}

function isPlanStatus(value: string | undefined): value is PlanStatus {
  return value === "ACTIVE" || value === "ENDED";
}

export function createListPlansUseCase<Trx>(deps: MedicationsDeps<Trx>) {
  return async function listPlans(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    query: ListMedicationPlansQuery,
    context: RequestContext,
  ): Promise<CursorPage<MedicationPlan>> {
    const { limit, cursor } = parsePageParams(query.limit, query.cursor);

    return deps.withTransaction(async (trx) => {
      const ctx = await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "READ",
        subjectMemberId: memberId,
        category: "MEDICATION",
      });

      const page = await deps.plansRepo.listByMember(trx, familyId, memberId, isPlanStatus(query.status) ? { status: query.status } : {}, limit, cursor);
      await auditViewIfNotSelf(deps, trx, ctx, { userId: actor.userId, familyId, memberId, resourceType: "MedicationPlan", context });
      return page;
    });
  };
}
