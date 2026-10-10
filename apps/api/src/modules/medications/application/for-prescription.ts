// API pública cruzada para `prescriptions` (modules.md §3.6: "a orquestração fica em
// `prescriptions`, que chama `medications`") — mesmo padrão de `documents/application/for-resource.ts`:
// recebem `trx` diretamente (nunca abrem a sua própria transação), para `prescriptions` as poder
// chamar dentro da MESMA transação da sua própria escrita.
import type { MedicationPlan } from "../domain/medication-plan.js";
import { clearFuturePendingOccurrences } from "./generation.js";
import type { MedicationsDeps } from "./ports.js";

export function createListPlansForPrescriptionUseCase<Trx>(deps: MedicationsDeps<Trx>) {
  return async function listPlansForPrescription(trx: Trx, familyId: string, memberId: string, prescriptionId: string): Promise<MedicationPlan[]> {
    return deps.plansRepo.listByPrescription(trx, familyId, memberId, prescriptionId);
  };
}

/** BR-RX-04: concluir/cancelar uma receita termina os planos associados (ocorrências futuras
 * removidas; histórico mantém-se) — chamado por `prescriptions.setPrescriptionStatus`. */
export function createEndPlansForPrescriptionUseCase<Trx>(deps: MedicationsDeps<Trx>) {
  return async function endPlansForPrescription(trx: Trx, familyId: string, memberId: string, prescriptionId: string, endedAt: Date): Promise<void> {
    const plans = await deps.plansRepo.listByPrescription(trx, familyId, memberId, prescriptionId);
    for (const plan of plans) {
      if (plan.status !== "ACTIVE") {
        continue;
      }
      await deps.plansRepo.updateStatus(trx, familyId, memberId, plan.id, "ENDED", endedAt);
      await clearFuturePendingOccurrences(deps.dosesRepo, trx, plan.id, endedAt);
    }
  };
}
