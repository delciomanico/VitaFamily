// openapi.yaml `putBloodType`: "Autorização: WRITE(ALLERGIES)". AC-HLT-01: escrita auditada
// (BLOODTYPE_UPDATE). Valor escrito pela API pública de `families` (modules.md §3 nota 9).
import { auditContextFields } from "../../audit/index.js";
import type { BloodType } from "../domain/blood-type.js";
import type { ActorIdentity, HealthRecordsDeps, RequestContext } from "./ports.js";

export interface PutBloodTypeInput {
  bloodType: BloodType;
}

export function createPutBloodTypeUseCase<Trx>(deps: HealthRecordsDeps<Trx>) {
  return async function putBloodType(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    input: PutBloodTypeInput,
    context: RequestContext,
  ): Promise<BloodType> {
    return deps.withTransaction(async (trx) => {
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "UPDATE",
        subjectMemberId: memberId,
        category: "ALLERGIES",
      });

      const bloodType = await deps.familiesPort.setBloodType(trx, familyId, memberId, input.bloodType);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: actor.userId,
        action: "BLOODTYPE_UPDATE",
        resourceType: "BloodType",
        resourceId: memberId,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      return bloodType;
    });
  };
}
