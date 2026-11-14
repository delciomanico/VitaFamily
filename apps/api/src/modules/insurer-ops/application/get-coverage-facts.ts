// `ProcessFacts.getCoverageFacts` (ADR-034, modules.md nota 31c): implementada AQUI, consumida por `processes` (ligação em `main/api.ts`).
// Projeção pura (`domain/coverage-phase.ts`) dos pedidos ligados a cada processo; em lote, sem N+1. Só leitura, sem ator.
import type { CoverageFact } from "../domain/coverage-phase.js";
import type { OpsDeps } from "./ports.js";

export function createGetCoverageFactsUseCase<Trx>(deps: Pick<OpsDeps<Trx>, "authorizations">) {
  return async function getCoverageFacts(trx: Trx, _familyId: string, processIds: string[]): Promise<{ processId: string; fact: CoverageFact }[]> {
    return deps.authorizations.coverageFacts(trx, processIds);
  };
}
