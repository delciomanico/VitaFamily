// openapi.yaml `updateMedicationPlan`: "Autorização: WRITE(MEDICATION). BR-RX-05: recalcula tomas
// PENDING futuras." `startAt`/`scheduleType` base não mudam de forma independente do desenho — o
// patch funde-se com o plano existente e revalida o conjunto (schema.md §3 CHECKs continuam válidos
// depois da alteração).
import { auditContextFields } from "../../audit/index.js";
import { assertValidSchedule, type MedicationPlan } from "../domain/medication-plan.js";
import { regeneratePlanOccurrences } from "./generation.js";
import type { ActorIdentity, MedicationPlanChanges, MedicationsDeps, RequestContext } from "./ports.js";
import { NotFoundError } from "../../../platform/errors/index.js";

export interface UpdateMedicationPlanInput {
  name?: string;
  dosage?: string;
  scheduleType?: "FIXED_TIMES" | "INTERVAL";
  times?: string[] | null;
  daysOfWeek?: number[] | null;
  intervalHours?: number | null;
  endAt?: string | null;
  continuous?: boolean | null;
  notes?: string | null;
}

export function createUpdatePlanUseCase<Trx>(deps: MedicationsDeps<Trx>) {
  return async function updatePlan(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    planId: string,
    input: UpdateMedicationPlanInput,
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

      const scheduleType = input.scheduleType ?? existing.scheduleType;
      const endAt = input.endAt === null ? null : input.endAt !== undefined ? new Date(input.endAt) : existing.endAt ?? null;
      const continuous = input.continuous ?? existing.continuous;
      const times = input.times === null ? null : input.times ?? existing.times ?? null;
      const daysOfWeek = input.daysOfWeek === null ? null : input.daysOfWeek ?? existing.daysOfWeek ?? null;
      const intervalHours = input.intervalHours === null ? null : input.intervalHours ?? existing.intervalHours ?? null;

      const validated = assertValidSchedule({
        scheduleType,
        times,
        daysOfWeek,
        intervalHours,
        startAt: existing.startAt,
        endAt,
        continuous,
      });

      const changes: MedicationPlanChanges = {
        continuous: validated.continuous,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.dosage !== undefined ? { dosage: input.dosage } : {}),
        ...(input.scheduleType !== undefined ? { scheduleType: input.scheduleType } : {}),
        times: validated.times ?? null,
        daysOfWeek: validated.daysOfWeek ?? null,
        intervalHours: validated.intervalHours ?? null,
        endAt: validated.endAt ?? null,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      };
      const plan = await deps.plansRepo.update(trx, familyId, memberId, planId, changes);

      const now = deps.clock.now();
      if (plan.status === "ACTIVE") {
        const timeZone = await deps.timezone.getEffectiveTimezone(trx, familyId, memberId);
        await regeneratePlanOccurrences(deps.dosesRepo, trx, plan, now, timeZone);
      }

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "PLAN_UPDATE",
        resourceType: "MedicationPlan",
        resourceId: plan.id,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      return plan;
    });
  };
}
