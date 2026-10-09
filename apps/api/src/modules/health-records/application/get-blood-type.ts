// openapi.yaml `getBloodType`: "Autorização: READ(ALLERGIES)". FR-HP-01: tipo sanguíneo partilha a
// matriz de ALLERGIES (mesma categoria), mas o valor vive em `family_members` (modules.md §3 nota
// 9) — lido pela API pública de `families` (`familiesPort.getBloodType`).
import { UNKNOWN_BLOOD_TYPE, type BloodType } from "../domain/blood-type.js";
import type { ActorIdentity, HealthRecordsDeps, RequestContext } from "./ports.js";
import { auditViewIfNotSelf } from "./support.js";

export function createGetBloodTypeUseCase<Trx>(deps: HealthRecordsDeps<Trx>) {
  return async function getBloodType(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    context: RequestContext,
  ): Promise<BloodType> {
    return deps.withTransaction(async (trx) => {
      const ctx = await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "READ",
        subjectMemberId: memberId,
        category: "ALLERGIES",
      });
      const bloodType = await deps.familiesPort.getBloodType(trx, familyId, memberId);
      await auditViewIfNotSelf(deps, trx, ctx, { userId: actor.userId, familyId, memberId, resourceType: "BloodType", context });
      return bloodType ?? UNKNOWN_BLOOD_TYPE;
    });
  };
}
