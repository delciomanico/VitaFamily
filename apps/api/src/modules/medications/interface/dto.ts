// Mapeamento das vistas da application -> forma da API (components.schemas, openapi.yaml:
// MedicationPlan, Dose, AdherenceItem).
import type { DoseOccurrence } from "../domain/dose-occurrence.js";
import type { MedicationPlan } from "../domain/medication-plan.js";
import type { AdherenceItem, CursorPage } from "../application/ports.js";

export function toMedicationPlanResponse(plan: MedicationPlan) {
  return {
    id: plan.id,
    memberId: plan.memberId,
    prescriptionId: plan.prescriptionId ?? null,
    name: plan.name,
    dosage: plan.dosage,
    scheduleType: plan.scheduleType,
    times: plan.times ?? [],
    daysOfWeek: plan.daysOfWeek ?? [],
    intervalHours: plan.intervalHours ?? null,
    startAt: plan.startAt.toISOString(),
    endAt: plan.endAt ? plan.endAt.toISOString() : null,
    continuous: plan.continuous,
    notes: plan.notes ?? null,
    status: plan.status,
  };
}

export function toMedicationPlanPage(page: CursorPage<MedicationPlan>) {
  return { items: page.items.map(toMedicationPlanResponse), nextCursor: page.nextCursor };
}

export function toDoseResponse(dose: DoseOccurrence) {
  return {
    id: dose.id,
    planId: dose.planId,
    medicationName: dose.medicationName,
    dosage: dose.dosage,
    scheduledAt: dose.scheduledAt.toISOString(),
    status: dose.status,
    actedAt: dose.actedAt ? dose.actedAt.toISOString() : null,
    actedByUserId: dose.actedByUserId ?? null,
    note: dose.note ?? null,
  };
}

export function toDosePage(page: CursorPage<DoseOccurrence>) {
  return { items: page.items.map(toDoseResponse), nextCursor: page.nextCursor };
}

export function toAdherenceResponse(items: AdherenceItem[]) {
  return items.map((item) => ({
    planId: item.planId,
    medicationName: item.medicationName,
    taken: item.taken,
    notTaken: item.notTaken,
    unconfirmed: item.unconfirmed,
    pending: item.pending,
  }));
}
