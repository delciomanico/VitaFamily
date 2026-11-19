// Jobs de manutenção de `consultations` (sem pg-boss; testáveis diretamente): `reconcile-bookings` (BR-MKT-54, UC-MKT-34) e
// `requeue-pending-proofs` (OP-114 iii). Ambos IDEMPOTENTES: reconcile só atua sobre `REQUESTED`/`CONFIRMED` sob `FOR UPDATE` e volta a
// verificar a razão dentro da transação (uma marcação já tratada ou entretanto confirmada não se cancela); o requeue só volta a pôr na fila
// o que continua `PENDING` (o antivírus é idempotente).
// Privacidade: a auditoria e o alerta não levam texto livre, nome, hora nem valor (BR-MKT-63/65).
import { checkBookingAction, isRequestExpired, transitionEffects, type BookingSystemReason } from "../domain/booking.js";
import type { AuditPort, BookingAlerts, BookingRecord, BookingRepository, ConsultationsClock, FamilyAppointmentWriter, ProfessionalAgenda, ProofRepository, ProofScanQueue, WithTransaction } from "./ports.js";

const PAGE = 200;
/** Teto de páginas por execução (a execução seguinte, 5 min depois, continua: o que já foi cancelado sai do conjunto). */
const MAX_PAGES = 25;
export const PENDING_PROOF_AGE_MS = 15 * 60_000;

export interface ReconcileDeps<Trx> {
  withTransaction: WithTransaction<Trx>;
  clock: ConsultationsClock;
  audit: AuditPort<Trx>;
  bookings: BookingRepository<Trx>;
  agenda: Pick<ProfessionalAgenda<Trx>, "findIdentities" | "releaseSlot">;
  appointments: Pick<FamilyAppointmentWriter<Trx>, "syncFromBooking">;
  alerts: BookingAlerts<Trx>;
}

/** Razão para o sistema cancelar AGORA, ou `null` (BR-MKT-54). `approved === undefined` (identidade desconhecida) nunca cancela. */
function reasonFor(booking: BookingRecord, nowMs: number, approved: boolean | undefined): BookingSystemReason | null {
  if (isRequestExpired({ status: booking.status, createdAtMs: booking.createdAt.getTime(), startsAtMs: booking.startsAt.getTime() }, nowMs)) return "REQUEST_EXPIRED";
  if (booking.startsAt.getTime() > nowMs && approved === false) return "PROFESSIONAL_UNAVAILABLE";
  return null;
}

export function createReconcileBookings<Trx>(deps: ReconcileDeps<Trx>) {
  async function cancelOne(candidate: BookingRecord, nowMs: number): Promise<boolean> {
    return deps.withTransaction(async (trx) => {
      const current = await deps.bookings.findById(trx, candidate.id, true);
      if (!current) return false;
      // Estado lido sob bloqueio; a razão volta a calcular-se com a identidade atual (sem cache) para não cancelar por dados velhos.
      const identity = (await deps.agenda.findIdentities([current.professionalId]))[0];
      const reason = reasonFor(current, nowMs, identity?.approved);
      if (!reason) return false;
      const check = checkBookingAction({ status: current.status, startsAtMs: current.startsAt.getTime() }, "CANCEL_BY_SYSTEM", nowMs);
      if (!check.ok) return false;
      const at = deps.clock.now();
      await deps.bookings.markCancelled(trx, current.id, { cancelledBy: "SYSTEM", systemReason: reason, at, statusReason: null });
      const effects = transitionEffects(check.to);
      if (effects.releaseSlot) await deps.agenda.releaseSlot(trx, current.id);
      if (effects.updateAppointment) await deps.appointments.syncFromBooking(trx, { bookingId: current.id, status: "CANCELLED" });
      await deps.audit.record(trx, {
        occurredAt: at,
        actorType: "SYSTEM",
        action: "BOOKING_AUTO_CANCEL",
        resourceType: "Booking",
        resourceId: current.id,
        familyId: current.familyId,
        subjectMemberId: current.memberId,
        result: "SUCCESS",
        requestId: "job:consultations.reconcile-bookings",
        metadata: { fromStatus: current.status, systemReason: reason },
      });
      await deps.alerts.raise(trx, { kind: "BOOKING_UPDATED", bookingId: current.id, familyId: current.familyId, memberId: current.memberId, stateVersion: at.toISOString() });
      return true;
    });
  }

  /** Devolve quantas marcações cancelou. */
  return async function reconcileBookings(): Promise<number> {
    const nowMs = deps.clock.now().getTime();
    let cancelled = 0;
    let after: { startsAt: Date; id: string } | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = await deps.withTransaction((trx) => deps.bookings.listReconcileCandidates(trx, deps.clock.now(), PAGE, after));
      if (rows.length === 0) break;
      const identities = new Map((await deps.agenda.findIdentities([...new Set(rows.map((r) => r.professionalId))])).map((i) => [i.id, i.approved]));
      for (const row of rows) {
        if (reasonFor(row, nowMs, identities.get(row.professionalId)) && (await cancelOne(row, nowMs))) cancelled += 1;
      }
      const last = rows.at(-1);
      if (rows.length < PAGE || !last) break;
      after = { startsAt: last.startsAt, id: last.id };
    }
    return cancelled;
  };
}

export interface RequeueDeps<Trx> {
  withTransaction: WithTransaction<Trx>;
  clock: ConsultationsClock;
  proofs: Pick<ProofRepository<Trx>, "listPendingBefore">;
  scanQueue: ProofScanQueue;
}

/** Volta a enfileirar o antivírus dos comprovativos `PENDING` há mais de 15 min (job perdido). Devolve quantos reenfileirou. */
export function createRequeuePendingProofs<Trx>(deps: RequeueDeps<Trx>) {
  return async function requeuePendingProofs(): Promise<number> {
    const before = new Date(deps.clock.now().getTime() - PENDING_PROOF_AGE_MS);
    const ids = await deps.withTransaction((trx) => deps.proofs.listPendingBefore(trx, before, 500));
    for (const proofId of ids) await deps.scanQueue.enqueueScan({ proofId });
    return ids.length;
  };
}

