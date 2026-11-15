// Carrega, em lote e sem N+1, os factos de um conjunto de processos: o do ato (origens com ato) e o de cobertura (todas).
import { hasAct, type ActFact, type CoverageFact, type Process } from "../domain/process.js";
import type { ProcessesDeps } from "./ports.js";

export interface LoadedFacts {
  /** Por `tipo:id` do ato. */
  acts: Map<string, ActFact>;
  /** Por `processId`. */
  coverages: Map<string, CoverageFact>;
}

export async function loadProcessFacts<Trx>(deps: Pick<ProcessesDeps<Trx>, "facts">, trx: Trx, familyId: string, processes: Process[]): Promise<LoadedFacts> {
  const refs = processes.filter((p) => hasAct(p.originType)).map((p) => ({ originType: p.originType, originId: p.originId }));
  const actEntries = refs.length > 0 ? await deps.facts.getActFacts(trx, familyId, refs) : [];
  const coverageEntries = processes.length > 0 ? await deps.facts.getCoverageFacts(trx, familyId, processes.map((p) => p.id)) : [];
  return {
    acts: new Map(actEntries.map((entry) => [`${entry.originType}:${entry.originId}`, entry.fact])),
    coverages: new Map(coverageEntries.map((entry) => [entry.processId, entry.fact])),
  };
}
