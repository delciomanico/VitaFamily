// UC-PRC-05 `GET /clinic-portal/processes/{processId}` (BR-PRC-06, authorization.md §6.8): o portal da clínica
// não usa `AccessPolicy` (ADR-020). Só Admin/Gestor; o Médico ⇒ `FORBIDDEN`. Outra clínica, sem clínica ou
// inexistente ⇒ `NOT_FOUND` igual. Leitura de ato próprio: não auditada.
import { ForbiddenError, NotFoundError } from "../../../platform/errors/index.js";
import type { ClinicPortalActor, ProcessesDeps } from "./ports.js";
import { loadProcessFacts } from "./load-facts.js";
import { readableFactsOf, toClinicProcessView, type ClinicProcessView } from "./process-view.js";

export function createGetClinicProcessUseCase<Trx>(deps: ProcessesDeps<Trx>) {
  return async function getClinicProcess(actor: ClinicPortalActor, processId: string): Promise<ClinicProcessView> {
    if (actor.role === "CLINIC_DOCTOR") {
      throw new ForbiddenError({ detail: "Sem permissão para ler processos." });
    }
    return deps.withTransaction(async (trx) => {
      const process = await deps.repo.findOfClinic(trx, actor.clinicId, processId);
      if (!process) {
        throw new NotFoundError({ detail: "Processo não encontrado." });
      }
      const facts = readableFactsOf(process, await loadProcessFacts(deps, trx, process.familyId, [process]));
      if (!facts) {
        deps.onInconsistency({ processId: process.id, originType: process.originType });
        throw new NotFoundError({ detail: "Processo não encontrado." });
      }
      return toClinicProcessView(process, facts);
    });
  };
}
