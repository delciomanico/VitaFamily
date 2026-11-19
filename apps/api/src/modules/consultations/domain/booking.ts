// Domínio puro de `consultations` (MK3, BR-MKT-50..66; state-machines.md «Booking»): estados, transições, janelas e limites da marcação.
// Sem I/O, sem relógio próprio (o instante entra por parâmetro) e sem importar nada fora de `domain/` (ADR-016).

export type BookingStatus = "REQUESTED" | "CONFIRMED" | "REJECTED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";
export const BOOKING_STATUSES: readonly BookingStatus[] = ["REQUESTED", "CONFIRMED", "REJECTED", "CANCELLED", "COMPLETED", "NO_SHOW"];
export type BookingPaymentStatus = "NOT_REQUIRED" | "AWAITING_PROOF" | "PROOF_SUBMITTED" | "CONFIRMED" | "REJECTED" | "DISPUTED";
export type BookingCancelledBy = "FAMILY" | "PROFESSIONAL" | "SYSTEM";
export type BookingSystemReason = "REQUEST_EXPIRED" | "PROFESSIONAL_UNAVAILABLE";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Limites e janelas de MK3 (PROPOSTA, OP-96): única fonte, para os testes e os casos de uso. */
export const BOOKING_LIMITS = {
  /** Antecedência mínima da marcação (BR-MKT-51). */
  minLeadMs: 2 * HOUR_MS,
  /** Janela máxima: 8 semanas. */
  maxLeadMs: 56 * DAY_MS,
  /** Pedido `REQUESTED` sem resposta caduca às 48 h (BR-MKT-54). */
  requestExpiryMs: 48 * HOUR_MS,
  /** Cancelamento da família com menos de 24 h até `startsAt` é «tardio» (só informativo, BR-MKT-52). */
  lateCancelMs: 24 * HOUR_MS,
  /** Marcações ativas (`REQUESTED`/`CONFIRMED`) por membro. */
  maxActivePerMember: 10,
  /** Criações de marcação por dia e por utilizador. */
  maxCreatesPerDay: 10,
  /** Janela para avaliar após `completedAt` (BR-MKT-59). */
  reviewWindowMs: 30 * DAY_MS,
  /** Janela para editar uma avaliação após a criação. */
  reviewEditWindowMs: 7 * DAY_MS,
  /** Intervalos curtos (utilitário dos testes). */
  minuteMs: MINUTE_MS,
} as const;

export const ACTIVE_BOOKING_STATUSES: readonly BookingStatus[] = ["REQUESTED", "CONFIRMED"];
export const TERMINAL_BOOKING_STATUSES: readonly BookingStatus[] = ["REJECTED", "CANCELLED", "COMPLETED", "NO_SHOW"];

export const isTerminalBooking = (status: BookingStatus): boolean => TERMINAL_BOOKING_STATUSES.includes(status);
export const isActiveBooking = (status: BookingStatus): boolean => ACTIVE_BOOKING_STATUSES.includes(status);

/** `NOT_REQUIRED` com preço 0 Kz; senão `AWAITING_PROOF` (BR-MKT-56). */
export function initialPaymentStatus(priceKz: number): BookingPaymentStatus {
  return priceKz === 0 ? "NOT_REQUIRED" : "AWAITING_PROOF";
}

export type BookingLeadCheck = "OK" | "TOO_SOON" | "TOO_FAR";

/** Antecedência da criação (BR-MKT-51): `agora + 2 h ≤ startsAt ≤ agora + 8 semanas`. */
export function checkBookingLead(startsAtMs: number, nowMs: number): BookingLeadCheck {
  if (startsAtMs < nowMs + BOOKING_LIMITS.minLeadMs) return "TOO_SOON";
  if (startsAtMs > nowMs + BOOKING_LIMITS.maxLeadMs) return "TOO_FAR";
  return "OK";
}

/** Sobreposição de intervalos semiabertos `[início, fim)`: encostar não sobrepõe. */
export function intervalsOverlap(aStartMs: number, aEndMs: number, bStartMs: number, bEndMs: number): boolean {
  return aStartMs < bEndMs && bStartMs < aEndMs;
}

/** Cancelamento «tardio» (derivado): da família, com menos de 24 h até `startsAt`; só informativo, sem sanção. */
export function isCancelledLate(input: { cancelledBy: BookingCancelledBy | null; cancelledAtMs: number | null; startsAtMs: number }): boolean {
  if (input.cancelledBy !== "FAMILY" || input.cancelledAtMs === null) return false;
  return input.startsAtMs - input.cancelledAtMs < BOOKING_LIMITS.lateCancelMs;
}

export type BookingAction = "CONFIRM" | "REJECT" | "CANCEL_BY_FAMILY" | "CANCEL_BY_PROFESSIONAL" | "CANCEL_BY_SYSTEM" | "COMPLETE" | "NO_SHOW";

const TRANSITIONS: Record<BookingAction, { from: readonly BookingStatus[]; to: BookingStatus }> = {
  CONFIRM: { from: ["REQUESTED"], to: "CONFIRMED" },
  REJECT: { from: ["REQUESTED"], to: "REJECTED" },
  CANCEL_BY_FAMILY: { from: ["REQUESTED", "CONFIRMED"], to: "CANCELLED" },
  CANCEL_BY_PROFESSIONAL: { from: ["REQUESTED", "CONFIRMED"], to: "CANCELLED" },
  CANCEL_BY_SYSTEM: { from: ["REQUESTED", "CONFIRMED"], to: "CANCELLED" },
  COMPLETE: { from: ["CONFIRMED"], to: "COMPLETED" },
  NO_SHOW: { from: ["CONFIRMED"], to: "NO_SHOW" },
};

export type BookingActionCheck =
  | { ok: true; to: BookingStatus }
  /** `INVALID_STATE`: estado de origem não permitido (inclui terminais e corrida) ⇒ `INVALID_STATE_TRANSITION`. `TOO_EARLY`/`TOO_LATE`: regra horária ⇒ o mesmo erro. */
  | { ok: false; reason: "INVALID_STATE" | "TOO_EARLY" | "TOO_LATE" };

/**
 * Valida uma ação sobre a marcação (BR-MKT-52): estado de origem e regra horária — família e profissional cancelam só ANTES de `startsAt`;
 * concluir/falta só com `agora ≥ startsAt`; o sistema cancela a qualquer hora (pedido caducado ou profissional indisponível).
 */
export function checkBookingAction(booking: { status: BookingStatus; startsAtMs: number }, action: BookingAction, nowMs: number): BookingActionCheck {
  const t = TRANSITIONS[action];
  if (!t.from.includes(booking.status)) return { ok: false, reason: "INVALID_STATE" };
  if ((action === "CANCEL_BY_FAMILY" || action === "CANCEL_BY_PROFESSIONAL") && nowMs >= booking.startsAtMs) return { ok: false, reason: "TOO_LATE" };
  if ((action === "COMPLETE" || action === "NO_SHOW") && nowMs < booking.startsAtMs) return { ok: false, reason: "TOO_EARLY" };
  return { ok: true, to: t.to };
}

/** Efeitos da transição na MESMA transação (state-machines.md): libertar o horário, criar/atualizar a consulta gerada. */
export function transitionEffects(to: BookingStatus): { releaseSlot: boolean; createAppointment: boolean; updateAppointment: boolean } {
  return {
    releaseSlot: to === "REJECTED" || to === "CANCELLED",
    createAppointment: to === "CONFIRMED",
    updateAppointment: to === "COMPLETED" || to === "NO_SHOW" || to === "CANCELLED",
  };
}

/** `meetingInfo` obrigatório ao confirmar `VIDEO`/`PHONE` (BR-MKT-52, OP-111). */
export function meetingInfoRequired(method: "IN_PERSON" | "VIDEO" | "CHAT" | "PHONE"): boolean {
  return method === "VIDEO" || method === "PHONE";
}

/** Pedido sem resposta há 48 h ou cujo `startsAt` já passou (alvo do job `reconcile-bookings`, BR-MKT-54). */
export function isRequestExpired(booking: { status: BookingStatus; createdAtMs: number; startsAtMs: number }, nowMs: number): boolean {
  return booking.status === "REQUESTED" && (nowMs - booking.createdAtMs >= BOOKING_LIMITS.requestExpiryMs || nowMs >= booking.startsAtMs);
}
