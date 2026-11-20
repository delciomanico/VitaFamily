// Vista da marcação para o PROFISSIONAL (BR-MKT-63; openapi `ProfessionalBooking`). NUNCA tem ids de família, membro nem utilizador,
// nem nome: só o `participantLabel` que a família escolheu. O comprovativo entra na fatia S8.
import { isCancelledLate } from "../domain/booking.js";
import type { BookingRecord, SpecialtyCategory } from "./ports.js";
import type { ProofView } from "./proof-views.js";

export interface ProfessionalBookingView {
  id: string;
  participantLabel: string;
  offer: { specialtyId: string; specialtyName: string; category: SpecialtyCategory; method: string; durationMinutes: number };
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
  conversationId: string | null;
  /** MK4 (BR-MKT-80): derivado; sempre `false` com a receita digital desligada. */
  canPrescribe: boolean;
  /** MK4: já emitiu receita nesta marcação; só com a receita digital ligada. */
  hasPrescription?: boolean;
  /** Comprovativo em curso (S8); AUSENTE quando não há: o schema `allOf`+`nullable` do contrato não aceita `null` na validação de respostas. */
  proof?: ProofView;
  createdAt: string;
  updatedAt: string;
}

export function toProfessionalBookingView(b: BookingRecord, c: { specialty: { name: string; category: SpecialtyCategory } | undefined; conversationId: string | null; proof?: ProofView | undefined; canPrescribe?: boolean; hasPrescription?: boolean }): ProfessionalBookingView {
  return {
    id: b.id,
    participantLabel: b.participantLabel,
    offer: { specialtyId: b.specialtyId, specialtyName: c.specialty?.name ?? "", category: c.specialty?.category ?? "HEALTH", method: b.method, durationMinutes: b.durationMinutes },
    priceKz: b.priceKz,
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    status: b.status,
    paymentStatus: b.paymentStatus,
    statusReason: b.statusReason,
    cancelledBy: b.cancelledBy,
    systemReason: b.systemReason,
    cancelledLate: isCancelledLate({ cancelledBy: b.cancelledBy, cancelledAtMs: b.cancelledAt?.getTime() ?? null, startsAtMs: b.startsAt.getTime() }),
    meetingInfo: b.meetingInfo,
    conversationId: c.conversationId,
    canPrescribe: c.canPrescribe ?? false,
    ...(c.hasPrescription !== undefined ? { hasPrescription: c.hasPrescription } : {}),
    ...(c.proof ? { proof: c.proof } : {}),
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}
