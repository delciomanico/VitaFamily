// openapi.yaml `deletePrescription`: "Autorização: WRITE(MEDICATION). BR-RX-06; aconselhar
// CANCELAR; documentos apagados via outbox." Ordem importa: apagar os documentos PRIMEIRO (via
// `documents.deleteAllForResource`, que enfileira o outbox de ficheiros antes de apagar as linhas)
// e só depois a receita — o CASCADE de `medication_plans`/`dose_occurrences` (schema.md §3, sem
// armazenamento externo) faz o resto ao apagar a linha de `prescriptions`.
import { auditContextFields } from "../../audit/index.js";
import { NotFoundError } from "../../../platform/errors/index.js";
import type { ActorIdentity, PrescriptionsDeps, RequestContext } from "./ports.js";

export function createDeletePrescriptionUseCase<Trx>(deps: PrescriptionsDeps<Trx>) {
  return async function deletePrescription(actor: ActorIdentity, familyId: string, memberId: string, prescriptionId: string, context: RequestContext): Promise<void> {
    return deps.withTransaction(async (trx) => {
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "DELETE",
        subjectMemberId: memberId,
        category: "MEDICATION",
      });

      const existing = await deps.prescriptionsRepo.findById(trx, familyId, memberId, prescriptionId);
      if (!existing) {
        throw new NotFoundError({ detail: "Receita não encontrada." });
      }

      await deps.documents.deleteAllForResource(trx, familyId, memberId, "PRESCRIPTION", prescriptionId);
      await deps.prescriptionsRepo.delete(trx, familyId, memberId, prescriptionId);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: actor.userId,
        action: "PRESCRIPTION_DELETE",
        resourceType: "Prescription",
        resourceId: prescriptionId,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
  };
}
