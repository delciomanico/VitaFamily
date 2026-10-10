// openapi.yaml `markDoseNotTaken`: "Autorização: Titular, tutor ou dependente com conta."
import type { DoseOccurrence } from "../domain/dose-occurrence.js";
import { applyDoseAction } from "./dose-actions.js";
import type { ActorIdentity, MedicationsDeps, RequestContext } from "./ports.js";
import type { DoseActionInput } from "./mark-dose-taken.js";

export function createMarkDoseNotTakenUseCase<Trx>(deps: MedicationsDeps<Trx>) {
  return async function markDoseNotTaken(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    doseId: string,
    input: DoseActionInput,
    context: RequestContext,
  ): Promise<DoseOccurrence> {
    return deps.withTransaction((trx) =>
      applyDoseAction(deps, trx, actor, familyId, memberId, doseId, "NOT_TAKEN", input.note, context, "DOSE_NOT_TAKEN"),
    );
  };
}
