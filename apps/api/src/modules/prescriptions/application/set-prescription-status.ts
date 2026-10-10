// openapi.yaml `setPrescriptionStatus`: "Autorização: WRITE(MEDICATION). ST1; terminar a receita
// termina os planos associados." BR-RX-04: concluir/cancelar termina os planos (via
// `medications.endPlansForPrescription` — modules.md §3.6); reabrir não os reativa (entities.md
// "Prescription": "reabrir não recria tomas passadas; o plano só retoma se for reativado").
import { auditContextFields } from "../../audit/index.js";
import { NotFoundError } from "../../../platform/errors/index.js";
import { assertValidPrescriptionTransition, type PrescriptionStatus } from "../domain/prescription.js";
import { buildPrescriptionView, type PrescriptionView } from "./prescription-view.js";
import type { ActorIdentity, PrescriptionsDeps, RequestContext } from "./ports.js";

export interface SetPrescriptionStatusInput {
  status: PrescriptionStatus;
}

export function createSetPrescriptionStatusUseCase<Trx>(deps: PrescriptionsDeps<Trx>) {
  return async function setPrescriptionStatus(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    prescriptionId: string,
    input: SetPrescriptionStatusInput,
    context: RequestContext,
  ): Promise<PrescriptionView> {
    return deps.withTransaction(async (trx) => {
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "UPDATE",
        subjectMemberId: memberId,
        category: "MEDICATION",
      });

      const existing = await deps.prescriptionsRepo.findById(trx, familyId, memberId, prescriptionId);
      if (!existing) {
        throw new NotFoundError({ detail: "Receita não encontrada." });
      }
      assertValidPrescriptionTransition(existing.status, input.status);

      const now = deps.clock.now();
      const prescription = await deps.prescriptionsRepo.updateStatus(trx, familyId, memberId, prescriptionId, input.status);

      if (input.status === "COMPLETED" || input.status === "CANCELLED") {
        await deps.medications.endPlansForPrescription(trx, familyId, memberId, prescriptionId, now);
      }

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "PRESCRIPTION_STATUS",
        resourceType: "Prescription",
        resourceId: prescriptionId,
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
