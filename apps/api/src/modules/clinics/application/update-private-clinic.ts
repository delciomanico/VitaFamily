// openapi.yaml `updatePrivateClinic`: "Autorização: Criador ou FAM_ADMIN. Parceiras não se
// alteram aqui."
import { auditContextFields } from "../../audit/index.js";
import { assertValidClinicName, type Clinic } from "../domain/clinic.js";
import type { ActorIdentity, ClinicChanges, ClinicsDeps, RequestContext } from "./ports.js";
import { requireCreatorOrFamilyAdmin, requireMembership, requirePrivateClinicOfFamily } from "./support.js";

export interface UpdatePrivateClinicInput {
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

export function createUpdatePrivateClinicUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function updatePrivateClinic(
    actor: ActorIdentity,
    familyId: string,
    clinicId: string,
    input: UpdatePrivateClinicInput,
    context: RequestContext,
  ): Promise<Clinic> {
    return deps.withTransaction(async (trx) => {
      const facts = await requireMembership(deps, trx, familyId, actor.userId);
      const clinic = await requirePrivateClinicOfFamily(deps, trx, familyId, clinicId);
      requireCreatorOrFamilyAdmin(facts, actor.userId, clinic);

      const changes: ClinicChanges = {};
      if (input.name !== undefined && input.name !== null) {
        changes.name = assertValidClinicName(input.name);
      }
      if (input.address !== undefined) changes.address = input.address;
      if (input.phone !== undefined) changes.phone = input.phone;
      if (input.email !== undefined) changes.email = input.email;

      const updated = await deps.clinicsRepo.update(trx, clinicId, changes);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: actor.userId,
        action: "CLINIC_UPDATE",
        resourceType: "Clinic",
        resourceId: clinicId,
        familyId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      return updated;
    });
  };
}
