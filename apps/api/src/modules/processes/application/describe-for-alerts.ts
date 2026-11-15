// `describeForAlerts` (ADR-036, modules.md nota 33a): leitura de SISTEMA (sem ator) que dá ao módulo `alerts` o dono de cada processo
// (`familyId`/`memberId`) e se continua aberto (`SCHEDULED`/`IN_PROGRESS`), para destinar o alerta e não avisar de um processo já
// terminado (BR-ALR-10). Não decide acesso: os destinatários resolvem-se em `alerts` (titular/tutores, BR-ALR-11).
import { deriveFamilyStatus } from "../domain/derive-family-status.js";
import type { Process } from "../domain/process.js";
import { loadProcessFacts } from "./load-facts.js";
import { readableFactsOf } from "./process-view.js";
import type { ProcessesDeps } from "./ports.js";

export interface ProcessAlertTarget {
  processId: string;
  familyId: string;
  memberId: string;
  /** `familyStatus` ∈ `SCHEDULED`/`IN_PROGRESS`; sem ato legível ⇒ `false`. */
  open: boolean;
}

export function createDescribeForAlertsUseCase<Trx>(deps: Pick<ProcessesDeps<Trx>, "repo" | "facts">) {
  return async function describeForAlerts(trx: Trx, processIds: string[]): Promise<ProcessAlertTarget[]> {
    const processes = await deps.repo.findByIds(trx, [...new Set(processIds)]);
    const byFamily = new Map<string, Process[]>();
    for (const process of processes) byFamily.set(process.familyId, [...(byFamily.get(process.familyId) ?? []), process]);

    const targets: ProcessAlertTarget[] = [];
    for (const [familyId, owned] of byFamily) {
      const loaded = await loadProcessFacts(deps, trx, familyId, owned);
      for (const process of owned) {
        const facts = readableFactsOf(process, loaded);
        const status = facts ? deriveFamilyStatus(facts).familyStatus : undefined;
        targets.push({ processId: process.id, familyId, memberId: process.memberId, open: status === "SCHEDULED" || status === "IN_PROGRESS" });
      }
    }
    return targets;
  }
}
