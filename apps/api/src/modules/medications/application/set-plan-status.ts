// openapi.yaml `setMedicationPlanStatus`: "Autorização: WRITE(MEDICATION). ST1." ACTIVE->ENDED
// remove a agenda futura (histórico mantém-se, UC-MED-04); ENDED->ACTIVE só gera tomas futuras
// (entities.md "MedicationPlan": "reabrir não recria tomas passadas").
import { auditContextFields } from "../../audit/index.js";
import { NotFoundError } from "../../../platform/errors/index.js";
import { assertValidPlanTransition, assertValidSchedule, type MedicationPlan, type PlanStatus } from "../domain/medication-plan.js";
import { clearFuturePendingOccurrences, regeneratePlanOccurrences } from "./generation.js";
import type { ActorIdentity, MedicationsDeps, RequestContext } from "./ports.js";

export interface SetPlanStatusInput {
  status: PlanStatus;
  endAt?: string | null;
  continuous?: boolean | null;
}

export function createSetPlanStatusUseCase<Trx>(deps: MedicationsDeps<Trx>) {
  return async function setPlanStatus(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    planId: string,
    input: SetPlanStatusInput,
    context: RequestContext,
  ): Promise<MedicationPlan> {
    return deps.withTransaction(async (trx) => {
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "UPDATE",
        subjectMemberId: memberId,
        category: "MEDICATION",
      });

      const existing = await deps.plansRepo.findById(trx, familyId, memberId, planId);
      if (!existing) {
        throw new NotFoundError({ detail: "Plano não encontrado." });
      }
      assertValidPlanTransition(existing.status, input.status);

      const now = deps.clock.now();

      if (input.status === "ENDED") {
        const plan = await deps.plansRepo.updateStatus(trx, familyId, memberId, planId, "ENDED", now);
        await clearFuturePendingOccurrences(deps.dosesRepo, trx, planId, now);
        await recordAudit(deps, trx, actor, familyId, memberId, plan.id, context, now);
        return plan;
      }

      // ENDED -> ACTIVE (reabrir): endAt/continuous opcionais definem a nova vigência (PlanStatusRequest).
      const endAt = input.endAt === null ? null : input.endAt !== undefined ? new Date(input.endAt) : existing.endAt ?? null;
      const continuous = input.continuous ?? existing.continuous;
      const validated = assertValidSchedule({
        scheduleType: existing.scheduleType,
        times: existing.times ?? null,
        daysOfWeek: existing.daysOfWeek ?? null,
        intervalHours: existing.intervalHours ?? null,
        startAt: existing.startAt,
        endAt,
        continuous,
      });
      await deps.plansRepo.update(trx, familyId, memberId, planId, { endAt: validated.endAt ?? null, continuous: validated.continuous });
      const plan = await deps.plansRepo.updateStatus(trx, familyId, memberId, planId, "ACTIVE", null);

      const timeZone = await deps.timezone.getEffectiveTimezone(trx, familyId, memberId);
      await regeneratePlanOccurrences(deps.dosesRepo, trx, plan, now, timeZone);

      await recordAudit(deps, trx, actor, familyId, memberId, plan.id, context, now);
      return plan;
    });
  };
}

async function recordAudit<Trx>(
  deps: MedicationsDeps<Trx>,
  trx: Trx,
  actor: ActorIdentity,
  familyId: string,
  memberId: string,
  planId: string,
  context: RequestContext,
  now: Date,
): Promise<void> {
  await deps.audit.record(trx, {
    occurredAt: now,
    actorType: "USER",
    actorUserId: actor.userId,
    action: "PLAN_STATUS",
    resourceType: "MedicationPlan",
    resourceId: planId,
    familyId,
    subjectMemberId: memberId,
    result: "SUCCESS",
    requestId: context.requestId,
    ...auditContextFields(context),
  });
}
