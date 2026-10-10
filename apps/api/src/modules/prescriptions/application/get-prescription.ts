// openapi.yaml `getPrescription`: "Autorização: READ(MEDICATION)."
import { NotFoundError } from "../../../platform/errors/index.js";
import { buildPrescriptionView, type PrescriptionView } from "./prescription-view.js";
import { auditViewIfNotSelf } from "./support.js";
import type { ActorIdentity, PrescriptionsDeps, RequestContext } from "./ports.js";

export function createGetPrescriptionUseCase<Trx>(deps: PrescriptionsDeps<Trx>) {
  return async function getPrescription(actor: ActorIdentity, familyId: string, memberId: string, prescriptionId: string, context: RequestContext): Promise<PrescriptionView> {
    return deps.withTransaction(async (trx) => {
      const ctx = await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "READ",
        subjectMemberId: memberId,
        category: "MEDICATION",
      });

      const prescription = await deps.prescriptionsRepo.findById(trx, familyId, memberId, prescriptionId);
      if (!prescription) {
        throw new NotFoundError({ detail: "Receita não encontrada." });
      }
      await auditViewIfNotSelf(deps, trx, ctx, { userId: actor.userId, familyId, memberId, context });
      return buildPrescriptionView(deps, trx, prescription);
    });
  };
}
