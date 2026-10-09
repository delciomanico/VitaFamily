// openapi.yaml `updateCondition`: "Autorização: WRITE(CONDITIONS)".
import { NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertValidRecordName } from "../domain/allergy.js";
import { assertValidConditionDates, type ConditionKind, type MedicalCondition } from "../domain/medical-condition.js";
import type { ActorIdentity, ConditionChanges, HealthRecordsDeps, RequestContext } from "./ports.js";

export interface UpdateConditionInput {
  name?: string | null;
  kind?: ConditionKind | null;
  notes?: string | null;
  since?: string | null;
  until?: string | null;
}

export function createUpdateConditionUseCase<Trx>(deps: HealthRecordsDeps<Trx>) {
  return async function updateCondition(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    conditionId: string,
    input: UpdateConditionInput,
    context: RequestContext,
  ): Promise<MedicalCondition> {
    return deps.withTransaction(async (trx) => {
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "UPDATE",
        subjectMemberId: memberId,
        category: "CONDITIONS",
      });

      const existing = await deps.conditionsRepo.findById(trx, familyId, memberId, conditionId);
      if (!existing) {
        throw new NotFoundError({ detail: "Condição não encontrada." });
      }

      const changes: ConditionChanges = {};
      if (input.name !== undefined) {
        if (input.name === null) {
          throw new ValidationError([{ field: "name", message: "não pode ser vazio" }], { detail: "Nome inválido." });
        }
        changes.name = assertValidRecordName(input.name);
      }
      if (input.kind !== undefined) {
        if (input.kind === null) {
          throw new ValidationError([{ field: "kind", message: "não pode ser vazio" }], { detail: "Tipo inválido." });
        }
        changes.kind = input.kind;
      }
      if (input.notes !== undefined) {
        changes.notes = input.notes;
      }
      if (input.since !== undefined) {
        changes.since = input.since;
      }
      if (input.until !== undefined) {
        changes.until = input.until;
      }

      // schema.md §3 (`until >= since`): valida com os valores EFETIVOS (patch + existente), não
      // só o que vem no pedido — um PATCH pode alterar só um dos dois lados.
      const effectiveSince = input.since !== undefined ? (input.since ?? undefined) : existing.since;
      const effectiveUntil = input.until !== undefined ? (input.until ?? undefined) : existing.until;
      assertValidConditionDates(effectiveSince, effectiveUntil);

      const updated = await deps.conditionsRepo.update(trx, familyId, memberId, conditionId, changes);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: actor.userId,
        action: "CONDITION_UPDATE",
        resourceType: "Condition",
        resourceId: conditionId,
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
