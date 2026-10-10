// Job `medications.generate-doses` (modules.md §5: "diário + sob demanda. Janela de 14 dias.").
// Processo de sistema (worker, modules.md §4) — nunca autoriza nada (sem `policy`); mesmo critério
// de `documents` `scan-document.ts`. Ao reler o fuso efetivo a cada corrida, também cobre — com uma
// latência limitada à cadência do job — BR-MED-08 (mudar fuso) e a mudança de tutor principal, sem
// `medications` ter de depender de `families`/`users` (ver `medications/README.md`: pendente de
// decisão do proprietário sobre um gatilho imediato).
import type { MedicationsWorkerDeps } from "./ports.js";
import { regeneratePlanOccurrences } from "./generation.js";

export interface GenerateDosesJobResult {
  plansProcessed: number;
  plansFailed: number;
}

export function createGenerateDosesJobUseCase<Trx>(deps: MedicationsWorkerDeps<Trx>) {
  return async function generateDosesJob(): Promise<GenerateDosesJobResult> {
    const now = deps.clock.now();
    const plans = await deps.withTransaction((trx) => deps.plansRepo.listActiveForGeneration(trx, now));

    let plansProcessed = 0;
    let plansFailed = 0;
    // Um plano por transação: um plano com dados inconsistentes (ex.: dependente sem tutor por uma
    // falha de invariante noutro módulo) nunca deve impedir a geração dos restantes.
    for (const plan of plans) {
      try {
        await deps.withTransaction(async (trx) => {
          const timeZone = await deps.timezone.getEffectiveTimezone(trx, plan.familyId, plan.memberId);
          await regeneratePlanOccurrences(deps.dosesRepo, trx, plan, now, timeZone);
        });
        plansProcessed += 1;
      } catch {
        plansFailed += 1;
      }
    }
    return { plansProcessed, plansFailed };
  };
}
