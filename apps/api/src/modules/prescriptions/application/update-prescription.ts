// openapi.yaml `updatePrescription`: "Autorização: WRITE(MEDICATION)."
import { auditContextFields } from "../../audit/index.js";
import { NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { assertValidIssuedOn } from "../domain/prescription.js";
import { buildPrescriptionView, type PrescriptionView } from "./prescription-view.js";
import type { ActorIdentity, PrescriptionChanges, PrescriptionsDeps, RequestContext } from "./ports.js";

export interface UpdatePrescriptionInput {
  issuedOn?: string | null;
  doctorName?: string | null;
  notes?: string | null;
}

export function createUpdatePrescriptionUseCase<Trx>(deps: PrescriptionsDeps<Trx>) {
  return async function updatePrescription(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    prescriptionId: string,
    input: UpdatePrescriptionInput,
    context: RequestContext,
  ): Promise<PrescriptionView> {
    const now = deps.clock.now();
    // `issuedOn` é obrigatório no domínio (BR-RX-01) — o contrato permite `null` por uniformidade
    // do PrescriptionPatch, mas nunca é uma limpeza válida deste campo.
    const issuedOn = input.issuedOn;
    if (issuedOn === null) {
      throw new ValidationError([{ field: "issuedOn", message: "obrigatório" }], { detail: "Data de emissão não pode ser removida." });
    }
    if (issuedOn) {
      assertValidIssuedOn(issuedOn, now);
    }

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

      const changes: PrescriptionChanges = {
        ...(issuedOn !== undefined ? { issuedOn } : {}),
        ...(input.doctorName !== undefined ? { doctorName: input.doctorName } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      };
      const prescription = await deps.prescriptionsRepo.update(trx, familyId, memberId, prescriptionId, changes);

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "PRESCRIPTION_UPDATE",
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
