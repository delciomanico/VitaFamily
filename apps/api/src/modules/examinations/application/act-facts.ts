// Facto do ato para `processes` (BR-PRC-04, ProcessFacts): `phase` por projeção pura + `scheduledAt`/`changedAt`.
// Exames inexistentes ou com estado obsoleto (erro de integridade) ficam de fora: `processes` omite-os (BR-PRC-09), nunca 5xx.
import { ActIntegrityError, projectActPhase } from "../domain/act-phase.js";
import type { ActFactOfExamination, ActFactsSource } from "./ports.js";

export function createGetActFactsUseCase<Trx>(source: ActFactsSource<Trx>) {
  return async function getActFacts(trx: Trx, familyId: string, examinationIds: string[]): Promise<{ originId: string; fact: ActFactOfExamination }[]> {
    if (examinationIds.length === 0) return [];
    const entries: { originId: string; fact: ActFactOfExamination }[] = [];
    for (const row of await source.findStateRows(trx, familyId, examinationIds)) {
      try {
        entries.push({
          originId: row.id,
          fact: { source: "EXAMINATION", phase: projectActPhase(row.status), changedAt: row.updatedAt, ...(row.scheduledAt ? { scheduledAt: row.scheduledAt } : {}) },
        });
      } catch (error) {
        if (!(error instanceof ActIntegrityError)) throw error;
      }
    }
    return entries;
  };
}
