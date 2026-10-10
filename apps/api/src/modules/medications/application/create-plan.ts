// openapi.yaml `createMedicationPlan` (avulso) e `addPrescriptionMedication` (de uma receita):
// "Autorização: WRITE(MEDICATION)". BR-MED-01/02, R7, B5, Q1 — cria o plano e gera já as ocorrências
// dos próximos 14 dias (DM5, AC-RX-01). Exposto em duas formas: `createCreatePlanUseCase` (abre a
// sua própria transação, usado pelo router HTTP deste módulo) e `createPlanWithTrx` (recebe `trx`
// já aberto, usado por `prescriptions` — modules.md §3.6: a orquestração fica em `prescriptions`,
// que chama `medications` pela raiz, na MESMA transação da criação/alteração da receita).
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertValidSchedule, type MedicationPlan, type ScheduleType } from "../domain/medication-plan.js";
import { regeneratePlanOccurrences } from "./generation.js";
import type { ActorIdentity, MedicationsDeps, NewMedicationPlanRecord, RequestContext } from "./ports.js";

export interface CreateMedicationPlanInput {
  name: string;
  dosage: string;
  scheduleType: ScheduleType;
  times?: string[] | null;
  daysOfWeek?: number[] | null;
  intervalHours?: number | null;
  startAt: string;
  endAt?: string | null;
  continuous?: boolean | null;
  notes?: string | null;
}

export interface CreateMedicationPlanOptions {
  prescriptionId?: string;
}

export function createPlanWithTrx<Trx>(deps: MedicationsDeps<Trx>) {
  return async function createPlan(
    trx: Trx,
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    input: CreateMedicationPlanInput,
    context: RequestContext,
    options: CreateMedicationPlanOptions = {},
  ): Promise<MedicationPlan> {
    const startAt = new Date(input.startAt);
    const endAt = input.endAt ? new Date(input.endAt) : null;
    const validated = assertValidSchedule({
      scheduleType: input.scheduleType,
      times: input.times,
      daysOfWeek: input.daysOfWeek,
      intervalHours: input.intervalHours,
      startAt,
      endAt,
      continuous: input.continuous,
    });

    await deps.policy.can(trx, {
      userId: actor.userId,
      platformAdmin: actor.platformAdmin,
      familyId,
      action: "CREATE",
      subjectMemberId: memberId,
      category: "MEDICATION",
    });

    const now = deps.clock.now();
    const record: NewMedicationPlanRecord = {
      id: newId(),
      familyId,
      memberId,
      name: input.name,
      dosage: input.dosage,
      scheduleType: input.scheduleType,
      startAt,
      continuous: validated.continuous,
      createdAt: now,
      ...(options.prescriptionId ? { prescriptionId: options.prescriptionId } : {}),
      ...(validated.times ? { times: validated.times } : {}),
      ...(validated.daysOfWeek ? { daysOfWeek: validated.daysOfWeek } : {}),
      ...(validated.intervalHours !== undefined ? { intervalHours: validated.intervalHours } : {}),
      ...(validated.endAt ? { endAt: validated.endAt } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
    };
    const plan = await deps.plansRepo.insert(trx, record);

    const timeZone = await deps.timezone.getEffectiveTimezone(trx, familyId, memberId);
    await regeneratePlanOccurrences(deps.dosesRepo, trx, plan, now, timeZone);

    await deps.audit.record(trx, {
      occurredAt: now,
      actorType: "USER",
      actorUserId: actor.userId,
      action: "PLAN_CREATE",
      resourceType: "MedicationPlan",
      resourceId: plan.id,
      familyId,
      subjectMemberId: memberId,
      result: "SUCCESS",
      requestId: context.requestId,
      ...auditContextFields(context),
    });

    return plan;
  };
}

export function createCreatePlanUseCase<Trx>(deps: MedicationsDeps<Trx>) {
  const createPlan = createPlanWithTrx(deps);
  return async function createPlanUseCase(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    input: CreateMedicationPlanInput,
    context: RequestContext,
    options: CreateMedicationPlanOptions = {},
  ): Promise<MedicationPlan> {
    return deps.withTransaction((trx) => createPlan(trx, actor, familyId, memberId, input, context, options));
  };
}
