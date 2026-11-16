// Carrega, em lote e sem N+1, os factos do ato de um conjunto de processos (só origens com ato).
import { hasAct, type ActFact, type Process } from "../domain/process.js";
import type { ProcessesDeps } from "./ports.js";

export interface LoadedFacts {
  /** Por `tipo:id` do ato. */
  acts: Map<string, ActFact>;
}

export async function loadProcessFacts<Trx>(deps: Pick<ProcessesDeps<Trx>, "facts">, trx: Trx, familyId: string, processes: Process[]): Promise<LoadedFacts> {
  const refs = processes.filter((p) => hasAct(p.originType)).map((p) => ({ originType: p.originType, originId: p.originId }));
  const actEntries = refs.length > 0 ? await deps.facts.getActFacts(trx, familyId, refs) : [];
  return { acts: new Map(actEntries.map((entry) => [`${entry.originType}:${entry.originId}`, entry.fact])) };
}
