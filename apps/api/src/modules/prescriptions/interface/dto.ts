// Mapeamento das vistas da application -> forma da API (components.schemas.Prescription,
// openapi.yaml). `toEmbeddedMedicationPlan` duplica (de propósito) o mapeamento de
// `medications/interface/dto.ts`: um módulo só se importa pela raiz (`medications/index.ts`, que
// não expõe a camada `interface` de outro módulo — conventions.md §1/§3), e é uma função pura
// pequena (mesmo critério de `BloodType` em `health-records/README.md`).
import type { CursorPage, MedicationPlan } from "../application/ports.js";
import type { PrescriptionView } from "../application/prescription-view.js";

export function toEmbeddedMedicationPlan(plan: MedicationPlan) {
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

export function toPrescriptionResponse(prescription: PrescriptionView) {
  return {
    id: prescription.id,
    memberId: prescription.memberId,
    issuedOn: prescription.issuedOn,
    doctorName: prescription.doctorName ?? null,
    notes: prescription.notes ?? null,
    status: prescription.status,
    medications: prescription.medications.map(toEmbeddedMedicationPlan),
    documentIds: prescription.documentIds,
  };
}

export function toPrescriptionPage(page: CursorPage<PrescriptionView>) {
  return { items: page.items.map(toPrescriptionResponse), nextCursor: page.nextCursor };
}
