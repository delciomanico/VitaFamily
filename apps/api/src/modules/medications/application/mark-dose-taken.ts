// openapi.yaml `markDoseTaken`: "Autorização: Titular, tutor ou dependente com conta. D7, M4, Q2:
// idempotente; regista quem e quando."
import type { DoseOccurrence } from "../domain/dose-occurrence.js";
import { applyDoseAction } from "./dose-actions.js";
import type { ActorIdentity, MedicationsDeps, RequestContext } from "./ports.js";

export interface DoseActionInput {
  note?: string | null;
}

export function createMarkDoseTakenUseCase<Trx>(deps: MedicationsDeps<Trx>) {
  return async function markDoseTaken(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    doseId: string,
    input: DoseActionInput,
    context: RequestContext,
  ): Promise<DoseOccurrence> {
    return deps.withTransaction((trx) =>
      applyDoseAction(deps, trx, actor, familyId, memberId, doseId, "TAKEN", input.note, context, "DOSE_TAKEN"),
    );
  };
}
