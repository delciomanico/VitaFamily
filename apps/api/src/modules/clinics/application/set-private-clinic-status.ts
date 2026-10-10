// openapi.yaml `setPrivateClinicStatus`: "Autorização: Criador ou FAM_ADMIN." Arquivar/reativar —
// transição sempre bidirecional (state-machines.md Clinic), sem estado inválido possível.
import { auditContextFields } from "../../audit/index.js";
import type { Clinic, ClinicStatus } from "../domain/clinic.js";
import type { ActorIdentity, ClinicsDeps, RequestContext } from "./ports.js";
import { requireCreatorOrFamilyAdmin, requireMembership, requirePrivateClinicOfFamily } from "./support.js";

export interface SetPrivateClinicStatusInput {
  status: ClinicStatus;
}

export function createSetPrivateClinicStatusUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function setPrivateClinicStatus(
    actor: ActorIdentity,
    familyId: string,
    clinicId: string,
    input: SetPrivateClinicStatusInput,
    context: RequestContext,
  ): Promise<Clinic> {
    return deps.withTransaction(async (trx) => {
      const facts = await requireMembership(deps, trx, familyId, actor.userId);
      const clinic = await requirePrivateClinicOfFamily(deps, trx, familyId, clinicId);
      requireCreatorOrFamilyAdmin(facts, actor.userId, clinic);

      const updated = await deps.clinicsRepo.updateStatus(trx, clinicId, input.status);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: actor.userId,
        action: "CLINIC_STATUS",
        resourceType: "Clinic",
        resourceId: clinicId,
        familyId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { status: input.status },
      });

      return updated;
    });
  };
}
