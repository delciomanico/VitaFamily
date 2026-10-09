// openapi.yaml `updateAllergy`: "Autorização: WRITE(ALLERGIES). R6: só estado atual."
import { NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertValidRecordName, type Allergy } from "../domain/allergy.js";
import type { AllergyChanges, ActorIdentity, HealthRecordsDeps, RequestContext } from "./ports.js";

export interface UpdateAllergyInput {
  name?: string | null;
  notes?: string | null;
  since?: string | null;
}

export function createUpdateAllergyUseCase<Trx>(deps: HealthRecordsDeps<Trx>) {
  return async function updateAllergy(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    allergyId: string,
    input: UpdateAllergyInput,
    context: RequestContext,
  ): Promise<Allergy> {
    return deps.withTransaction(async (trx) => {
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "UPDATE",
        subjectMemberId: memberId,
        category: "ALLERGIES",
      });

      const existing = await deps.allergiesRepo.findById(trx, familyId, memberId, allergyId);
      if (!existing) {
        throw new NotFoundError({ detail: "Alergia não encontrada." });
      }

      const changes: AllergyChanges = {};
      if (input.name !== undefined) {
        if (input.name === null) {
          throw new ValidationError([{ field: "name", message: "não pode ser vazio" }], { detail: "Nome inválido." });
        }
        changes.name = assertValidRecordName(input.name);
      }
      if (input.notes !== undefined) {
        changes.notes = input.notes;
      }
      if (input.since !== undefined) {
        changes.since = input.since;
      }

      const updated = await deps.allergiesRepo.update(trx, familyId, memberId, allergyId, changes);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: actor.userId,
        action: "ALLERGY_UPDATE",
        resourceType: "Allergy",
        resourceId: allergyId,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      return updated;
    });
  };
}
