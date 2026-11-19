// `ProcessFacts` para `originType=BOOKING` (BR-MKT-55; state-machines.md 1b): `phase` e `hint` por projeção pura; o adaptador composto de
// `main/api.ts` despacha para aqui. Marcações inexistentes simplesmente não aparecem (BR-PRC-09 trata-as do lado de `processes`).
import { deriveBookingHint, projectBookingPhase, type BookingHint, type BookingPhase } from "../domain/projection.js";
import type { BookingRepository, ConsultationsClock } from "./ports.js";

export interface BookingActFact {
  source: "BOOKING";
  phase: BookingPhase;
  hint: BookingHint | null;
  scheduledAt: Date;
  changedAt: Date;
}

export function createGetBookingActFacts<Trx>(deps: { bookings: BookingRepository<Trx>; clock: ConsultationsClock }) {
  return async function getActFacts(trx: Trx, familyId: string, bookingIds: string[]): Promise<{ originId: string; fact: BookingActFact }[]> {
    if (bookingIds.length === 0) return [];
    const nowMs = deps.clock.now().getTime();
    const rows = await deps.bookings.findStateRows(trx, familyId, bookingIds);
    return rows.map((row) => ({
      originId: row.id,
      fact: {
        source: "BOOKING" as const,
        phase: projectBookingPhase(row.status),
        hint: deriveBookingHint({ status: row.status, paymentStatus: row.paymentStatus, completedAtMs: row.completedAt?.getTime() ?? null, hasReview: row.hasReview }, nowMs),
        scheduledAt: row.startsAt,
        changedAt: row.updatedAt,
      },
    }));
  };
}
