// `completeClinicAppointment` (D18, BR-CLN-06/BR-RX-07, endpoints.md `PUT
// /clinic-portal/agenda/{appointmentId}/complete`): emite a receita associada a uma consulta que o
// portal da clínica já validou como `SCHEDULED` e da própria clínica (authorization.md §6.1/§6.2).
// Exposta pela raiz de `prescriptions` (index.ts) e chamada por `appointments` através da porta
// `PrescriptionsPort` (appointments/application/ports.ts) — ligada no composition root
// (`main/api.ts`), nunca por um import direto de `modules/prescriptions` dentro de `appointments`
// (modules.md §2 não declara essa aresta; mesmo critério de `reports`/`lifecycle`, modules.md §3
// notas 16/20: porta na própria `application`, wiring só em `main`).
//
// **Nunca chama `AccessPolicy`**: o ator é um `ClinicAccount`, sem `userId`/`FamilyMember`
// (authorization.md linha 15: "AccessPolicy decide só sobre o ator de User/família"). A
// autorização desta operação já foi decidida inteiramente pelo algoritmo do portal da clínica,
// antes de `appointments` chegar a chamar esta função.
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { CreateMedicationPlanInput } from "../../medications/index.js";
import { assertHasMedications, assertValidIssuedOn } from "../domain/prescription.js";
import { buildPrescriptionView, type PrescriptionView } from "./prescription-view.js";
import type { NewPrescriptionRecord, PrescriptionsDeps, RequestContext } from "./ports.js";

export interface IssuePrescriptionForClinicInput {
  issuedOn: string;
  doctorName?: string | null;
  notes?: string | null;
  medications: CreateMedicationPlanInput[];
}

export interface ClinicPrescriptionOrigin {
  clinicAccountId: string;
  appointmentId: string;
}

export function createIssuePrescriptionForClinicUseCase<Trx>(deps: PrescriptionsDeps<Trx>) {
  return async function issuePrescriptionForClinic(
    trx: Trx,
    familyId: string,
    memberId: string,
    input: IssuePrescriptionForClinicInput,
    origin: ClinicPrescriptionOrigin,
    context: RequestContext,
  ): Promise<PrescriptionView> {
    const now = deps.clock.now();
    assertHasMedications(input.medications.length);
    assertValidIssuedOn(input.issuedOn, now);

    const record: NewPrescriptionRecord = {
      id: newId(),
      familyId,
      memberId,
      issuedOn: input.issuedOn,
      createdAt: now,
      issuedBy: "CLINIC",
      issuedByClinicAccountId: origin.clinicAccountId,
      appointmentId: origin.appointmentId,
      ...(input.doctorName ? { doctorName: input.doctorName } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
    };
    const prescription = await deps.prescriptionsRepo.insert(trx, record);

    for (const medication of input.medications) {
      await deps.medications.createPlanForClinic(trx, origin.clinicAccountId, familyId, memberId, medication, context, {
        prescriptionId: prescription.id,
      });
    }

    await deps.audit.record(trx, {
      occurredAt: now,
      actorType: "CLINIC_ACCOUNT",
      actorClinicAccountId: origin.clinicAccountId,
      action: "PRESCRIPTION_CREATE",
      resourceType: "Prescription",
      resourceId: prescription.id,
      familyId,
      subjectMemberId: memberId,
      result: "SUCCESS",
      requestId: context.requestId,
      ...auditContextFields(context),
      metadata: { appointmentId: origin.appointmentId },
    });

    return buildPrescriptionView(deps, trx, prescription);
  };
}
