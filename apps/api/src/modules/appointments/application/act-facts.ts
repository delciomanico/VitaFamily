// Facto do ato para `processes` (BR-PRC-04, ProcessFacts): `phase` por projeção pura + `scheduledAt`/`changedAt`.
// Consultas inexistentes simplesmente não aparecem no resultado (BR-PRC-09 trata-as do lado de `processes`).
import { projectActPhase } from "../domain/act-phase.js";
import type { ActFactOfAppointment, ActFactsSource } from "./ports.js";

export function createGetActFactsUseCase<Trx>(source: ActFactsSource<Trx>) {
  return async function getActFacts(trx: Trx, familyId: string, appointmentIds: string[]): Promise<{ originId: string; fact: ActFactOfAppointment }[]> {
    if (appointmentIds.length === 0) return [];
    const rows = await source.findStateRows(trx, familyId, appointmentIds);
    return rows.map((row) => ({
      originId: row.id,
      fact: { source: "APPOINTMENT", phase: projectActPhase(row), scheduledAt: row.scheduledAt, changedAt: row.updatedAt },
    }));
  };
}
