// openapi.yaml `createCondition`: "Autorização: WRITE(CONDITIONS)". AC-HLT-01: escrita auditada.
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertValidRecordName } from "../domain/allergy.js";
import { assertValidConditionDates, type ConditionKind, type MedicalCondition } from "../domain/medical-condition.js";
import type { ActorIdentity, HealthRecordsDeps, NewConditionRecord, RequestContext } from "./ports.js";

export interface CreateConditionInput {
  name: string;
  kind: ConditionKind;
  notes?: string | null;
  since?: string | null;
  until?: string | null;
}

export function createCreateConditionUseCase<Trx>(deps: HealthRecordsDeps<Trx>) {
  return async function createCondition(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    input: CreateConditionInput,
    context: RequestContext,
  ): Promise<MedicalCondition> {
    const name = assertValidRecordName(input.name);
    assertValidConditionDates(input.since ?? undefined, input.until ?? undefined);

    return deps.withTransaction(async (trx) => {
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "CREATE",
        subjectMemberId: memberId,
        category: "CONDITIONS",
      });

      const now = deps.clock.now();
      const record: NewConditionRecord = {
        id: newId(),
        familyId,
        memberId,
        name,
        kind: input.kind,
        createdAt: now,
        ...(input.notes ? { notes: input.notes } : {}),
        ...(input.since ? { since: input.since } : {}),
        ...(input.until ? { until: input.until } : {}),
      };
      const condition = await deps.conditionsRepo.insert(trx, record);

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "CONDITION_CREATE",
        resourceType: "Condition",
        resourceId: condition.id,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      return condition;
    });
  };
}
