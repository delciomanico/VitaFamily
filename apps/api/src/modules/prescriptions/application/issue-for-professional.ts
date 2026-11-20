// Receita digital (MK4, BR-MKT-79..81; UC-MKT-59/60): `issuePrescriptionForProfessional` e a leitura do que o profissional emitiu.
// Exposta pela raiz de `prescriptions` (index.ts) e chamada por `consultations` através da porta `PrescriptionIssuer`
// (consultations/application/ports.ts), ligada no composition root (`main/api.ts`); `prescriptions` NÃO importa `consultations`.
//
// **Nunca chama `AccessPolicy`**: o ator é uma `ProfessionalAccount`, sem `FamilyMember`; a autorização (flag, profissional `APPROVED`,
// marcação do profissional `COMPLETED`, categoria `HEALTH`, janela de 7 dias, uma por marcação) já foi decidida por `consultations`, sob
// bloqueio da marcação, antes de chamar isto. Recebe `trx` já aberto (a mesma da emissão). A auditoria `PRESCRIPTION_ISSUED_BY_PROFESSIONAL`
// fica só com `bookingId` e `medicationCount` (sem nomes, dosagens nem observações).
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { CreateMedicationPlanInput } from "../../medications/index.js";
import { assertHasMedications } from "../domain/prescription.js";
import type { NewPrescriptionRecord, PrescriptionsDeps, RequestContext } from "./ports.js";

export interface IssuePrescriptionForProfessionalInput {
  familyId: string;
  memberId: string;
  bookingId: string;
  professionalId: string;
  professionalAccountId: string;
  professionalName: string;
  /** Hoje em `Africa/Luanda` (fixado pelo servidor). */
  issuedOn: string;
  notes: string | null;
  medications: CreateMedicationPlanInput[];
}

/** O que o profissional escreveu (sem ids de registo): medicamentos no formato de entrada. */
export interface ProfessionalPrescriptionContent {
  prescriptionId: string;
  issuedOn: string;
  notes: string | null;
  medications: CreateMedicationPlanInput[];
  createdAt: Date;
}

export function createIssuePrescriptionForProfessionalUseCase<Trx>(deps: PrescriptionsDeps<Trx>) {
  return async function issuePrescriptionForProfessional(trx: Trx, input: IssuePrescriptionForProfessionalInput, context: RequestContext): Promise<{ prescriptionId: string }> {
    assertHasMedications(input.medications.length);
    const now = deps.clock.now();
    const record: NewPrescriptionRecord = {
      id: newId(),
      familyId: input.familyId,
      memberId: input.memberId,
      issuedOn: input.issuedOn,
      createdAt: now,
      issuedBy: "PROFESSIONAL",
      issuedByProfessionalId: input.professionalId,
      bookingId: input.bookingId,
      doctorName: input.professionalName,
      ...(input.notes ? { notes: input.notes } : {}),
    };
    const prescription = await deps.prescriptionsRepo.insert(trx, record);

    for (const medication of input.medications) {
      await deps.medications.createPlanForProfessional(trx, input.professionalAccountId, input.familyId, input.memberId, medication, context, { prescriptionId: prescription.id });
    }

    await deps.audit.record(trx, {
      occurredAt: now,
      actorType: "PROFESSIONAL_ACCOUNT",
      actorProfessionalAccountId: input.professionalAccountId,
      action: "PRESCRIPTION_ISSUED_BY_PROFESSIONAL",
      resourceType: "Prescription",
      resourceId: prescription.id,
      familyId: input.familyId,
      subjectMemberId: input.memberId,
      result: "SUCCESS",
      requestId: context.requestId,
      ...auditContextFields(context),
      metadata: { bookingId: input.bookingId, medicationCount: input.medications.length },
    });
    return { prescriptionId: prescription.id };
  };
}

/** Receita da marcação (só a emitida pelo profissional indicado); `null` se não existe ou a família a apagou. */
export function createGetProfessionalPrescriptionUseCase<Trx>(deps: PrescriptionsDeps<Trx>) {
  return async function getProfessionalPrescription(trx: Trx, bookingId: string, professionalId: string): Promise<ProfessionalPrescriptionContent | null> {
    const prescription = await deps.prescriptionsRepo.findByBooking(trx, bookingId);
    if (prescription?.issuedBy !== "PROFESSIONAL" || prescription.issuedByProfessionalId !== professionalId) return null;
    const plans = await deps.medications.listPlansForPrescription(trx, prescription.familyId, prescription.memberId, prescription.id);
    return {
      prescriptionId: prescription.id,
      issuedOn: prescription.issuedOn,
      notes: prescription.notes ?? null,
      createdAt: prescription.createdAt,
      medications: plans.map((plan) => ({
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
      })),
    };
  };
}

/** `bookingId → prescriptionId` em lote (`FamilyBooking.prescriptionId`, `canPrescribe`, `ProfessionalBooking.prescriptionId`). */
export function createFindPrescriptionIdsByBookingsUseCase<Trx>(deps: PrescriptionsDeps<Trx>) {
  return (trx: Trx, bookingIds: string[]): Promise<Map<string, string>> => deps.prescriptionsRepo.findIdsByBookings(trx, bookingIds);
}

/** OP-127: o conteúdo do plano de uma receita é só leitura para a família? (porta `PrescriptionOrigin` de `medications`). */
export function createIsContentReadOnlyUseCase<Trx>(deps: PrescriptionsDeps<Trx>) {
  return async (trx: Trx, familyId: string, memberId: string, prescriptionId: string): Promise<boolean> => {
    const prescription = await deps.prescriptionsRepo.findById(trx, familyId, memberId, prescriptionId);
    return prescription?.issuedBy === "PROFESSIONAL";
  };
}
