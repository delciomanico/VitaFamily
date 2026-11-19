// Vistas da marcação para a FAMÍLIA (BR-MKT-50/55/56; openapi `FamilyBooking`). Funções puras sobre o registo e os dados já lidos.
// Privacidade: `paymentInstructions` só com `CONFIRMED`/`COMPLETED` e preço > 0 (BR-MKT-26/56) e só no detalhe; `meetingInfo` só com
// `CONFIRMED`/`COMPLETED`; nunca ids de utilizador nem de outra família.
import { isActiveBooking, isCancelledLate } from "../domain/booking.js";
import { canShowPaymentInstructions } from "../domain/payment.js";
import { checkReviewCreate } from "../domain/review.js";
import type { BookingRecord, SpecialtyCategory } from "./ports.js";

export interface FamilyBookingView {
  id: string;
  memberId: string;
  professional: { id: string; displayName: string; city: string | null };
  offer: { specialtyId: string; specialtyName: string; category: SpecialtyCategory; method: string; durationMinutes: number };
  participantLabel: string;
  priceKz: number;
  startsAt: string;
  endsAt: string;
  status: string;
  paymentStatus: string;
  statusReason: string | null;
  cancelledBy: string | null;
  systemReason: string | null;
  cancelledLate: boolean;
  meetingInfo: string | null;
  paymentInstructions: string | null;
  processId: string | null;
  appointmentId: string | null;
  conversationId: string | null;
  canCancel: boolean;
  canSendProof: boolean;
  canReview: boolean;
  hasReview: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ViewContext {
  now: Date;
  professional: { displayName: string; city: string | null } | undefined;
  specialty: { name: string; category: SpecialtyCategory } | undefined;
  appointmentId: string | null;
  conversationId: string | null;
  hasReview: boolean;
  /** Só o detalhe a preenche (e só é usada se o estado o permitir). */
  paymentInstructions: string | null;
}

export function toFamilyBookingView(b: BookingRecord, c: ViewContext): FamilyBookingView {
  const nowMs = c.now.getTime();
  const showMeeting = b.status === "CONFIRMED" || b.status === "COMPLETED";
  const showInstructions = canShowPaymentInstructions(b.status, b.priceKz);
  const canSendProof = showInstructions && (b.paymentStatus === "AWAITING_PROOF" || b.paymentStatus === "REJECTED");
  const eligible = checkReviewCreate({ status: b.status, paymentStatus: b.paymentStatus, completedAtMs: b.completedAt?.getTime() ?? null }, nowMs).allowed;
  return {
    id: b.id,
    memberId: b.memberId,
    professional: { id: b.professionalId, displayName: c.professional?.displayName ?? "Profissional", city: c.professional?.city ?? null },
    offer: { specialtyId: b.specialtyId, specialtyName: c.specialty?.name ?? "", category: c.specialty?.category ?? "HEALTH", method: b.method, durationMinutes: b.durationMinutes },
    participantLabel: b.participantLabel,
    priceKz: b.priceKz,
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    status: b.status,
    paymentStatus: b.paymentStatus,
    statusReason: b.statusReason,
    cancelledBy: b.cancelledBy,
    systemReason: b.systemReason,
    cancelledLate: isCancelledLate({ cancelledBy: b.cancelledBy, cancelledAtMs: b.cancelledAt?.getTime() ?? null, startsAtMs: b.startsAt.getTime() }),
    meetingInfo: showMeeting ? b.meetingInfo : null,
    paymentInstructions: showInstructions ? c.paymentInstructions : null,
    processId: b.processId,
    appointmentId: c.appointmentId,
    conversationId: c.conversationId,
    canCancel: isActiveBooking(b.status) && nowMs < b.startsAt.getTime(),
    canSendProof,
    canReview: eligible && !c.hasReview,
    hasReview: c.hasReview,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}
