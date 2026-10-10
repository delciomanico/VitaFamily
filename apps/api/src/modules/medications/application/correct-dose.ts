// openapi.yaml `correctDose`: "Autorização: Quem agiu, titular ou tutor. ST2; auditado."
import type { DoseOccurrence, DoseStatus } from "../domain/dose-occurrence.js";
import { applyDoseCorrection } from "./dose-actions.js";
import type { ActorIdentity, MedicationsDeps, RequestContext } from "./ports.js";

export interface DoseCorrectionInput {
  status: DoseStatus;
  note?: string | null;
}

export function createCorrectDoseUseCase<Trx>(deps: MedicationsDeps<Trx>) {
  return async function correctDose(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    doseId: string,
    input: DoseCorrectionInput,
    context: RequestContext,
  ): Promise<DoseOccurrence> {
    return deps.withTransaction((trx) => applyDoseCorrection(deps, trx, actor, familyId, memberId, doseId, input.status, input.note, context));
  };
}
