// openapi.yaml `createPrescription`: "Autorização: WRITE(MEDICATION). BR-RX-01/02, M2, R7: data de
// emissão obrigatória e não futura; ≥1 medicamento; gera tomas e alertas." A orquestração com
// `medications` fica aqui (modules.md §3.6) — cada medicamento cria o seu `MedicationPlan` na MESMA
// transação da receita (tudo ou nada: se um medicamento for inválido, a receita toda é revertida).
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { CreateMedicationPlanInput } from "../../medications/index.js";
import { assertHasMedications, assertValidIssuedOn } from "../domain/prescription.js";
import { buildPrescriptionView, type PrescriptionView } from "./prescription-view.js";
import type { ActorIdentity, NewPrescriptionRecord, PrescriptionsDeps, RequestContext } from "./ports.js";

export interface CreatePrescriptionInput {
  issuedOn: string;
  doctorName?: string | null;
  notes?: string | null;
  medications: CreateMedicationPlanInput[];
}

export function createCreatePrescriptionUseCase<Trx>(deps: PrescriptionsDeps<Trx>) {
  return async function createPrescription(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    input: CreatePrescriptionInput,
    context: RequestContext,
  ): Promise<PrescriptionView> {
    const now = deps.clock.now();
    assertHasMedications(input.medications.length);
    assertValidIssuedOn(input.issuedOn, now);

    return deps.withTransaction(async (trx) => {
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "CREATE",
        subjectMemberId: memberId,
        category: "MEDICATION",
      });

      const record: NewPrescriptionRecord = {
        id: newId(),
        familyId,
        memberId,
        issuedOn: input.issuedOn,
        createdAt: now,
        ...(input.doctorName ? { doctorName: input.doctorName } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
      };
      const prescription = await deps.prescriptionsRepo.insert(trx, record);

      for (const medication of input.medications) {
        await deps.medications.createPlan(trx, actor, familyId, memberId, medication, context, { prescriptionId: prescription.id });
      }

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "PRESCRIPTION_CREATE",
        resourceType: "Prescription",
        resourceId: prescription.id,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      return buildPrescriptionView(deps, trx, prescription);
    });
  };
}
