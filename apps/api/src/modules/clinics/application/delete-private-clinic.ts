// openapi.yaml `deletePrivateClinic`: "Autorização: Criador ou FAM_ADMIN. BR-CLN-02: consultas
// mantêm o nome em texto." Eliminar a linha não apaga `clinicName` já copiado nas consultas/exames
// (snapshot, `appointments.clinic_name`/`examinations.clinic_name`) — o FK `clinic_id` fica NULL
// (schema.md `ON DELETE SET NULL`), sem intervenção deste módulo.
import { auditContextFields } from "../../audit/index.js";
import type { ActorIdentity, ClinicsDeps, RequestContext } from "./ports.js";
import { requireCreatorOrFamilyAdmin, requireMembership, requirePrivateClinicOfFamily } from "./support.js";

export function createDeletePrivateClinicUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function deletePrivateClinic(actor: ActorIdentity, familyId: string, clinicId: string, context: RequestContext): Promise<void> {
    return deps.withTransaction(async (trx) => {
      const facts = await requireMembership(deps, trx, familyId, actor.userId);
      const clinic = await requirePrivateClinicOfFamily(deps, trx, familyId, clinicId);
      requireCreatorOrFamilyAdmin(facts, actor.userId, clinic);

      await deps.clinicsRepo.delete(trx, clinicId);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: actor.userId,
        action: "CLINIC_DELETE",
        resourceType: "Clinic",
        resourceId: clinicId,
        familyId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
  };
}
