// openapi.yaml `createAllergy`: "Autorização: WRITE(ALLERGIES)". AC-HLT-01: escrita auditada.
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertValidRecordName, type Allergy } from "../domain/allergy.js";
import type { ActorIdentity, HealthRecordsDeps, NewAllergyRecord, RequestContext } from "./ports.js";

export interface CreateAllergyInput {
  name: string;
  notes?: string | null;
  since?: string | null;
}

export function createCreateAllergyUseCase<Trx>(deps: HealthRecordsDeps<Trx>) {
  return async function createAllergy(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    input: CreateAllergyInput,
    context: RequestContext,
  ): Promise<Allergy> {
    const name = assertValidRecordName(input.name);

    return deps.withTransaction(async (trx) => {
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "CREATE",
        subjectMemberId: memberId,
        category: "ALLERGIES",
      });

      const now = deps.clock.now();
      const record: NewAllergyRecord = {
        id: newId(),
        familyId,
        memberId,
        name,
        createdAt: now,
        ...(input.notes ? { notes: input.notes } : {}),
        ...(input.since ? { since: input.since } : {}),
      };
      const allergy = await deps.allergiesRepo.insert(trx, record);

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "ALLERGY_CREATE",
        resourceType: "Allergy",
        resourceId: allergy.id,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      return allergy;
    });
  };
}
