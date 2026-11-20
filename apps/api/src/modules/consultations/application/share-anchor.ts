// Extensão aditiva da raiz de `consultations` para MK4 (modules.md nota 38(b)): factos da marcação-âncora de uma partilha, lidos pelo
// `main/api.ts` para a porta `ShareAnchor` de `record-sharing` (que não importa este módulo). Só factos: nunca notas, preço, comprovativos
// nem ids de utilizador. A marcação procura-se SEMPRE por (família, membro, id): outra ⇒ `null` (BR-MKT-67).
import type { BookingStatus } from "../domain/booking.js";
import type { BookingRepository, ProfessionalAgenda } from "./ports.js";

export interface ShareAnchorFacts {
  professionalId: string;
  status: BookingStatus;
  startsAt: Date;
  endsAt: Date;
  participantLabel: string;
  professionalCategory: "HEALTH" | "WELLNESS";
}

export interface ShareAnchorStatus {
  status: BookingStatus;
}

export function createShareAnchor<Trx>(deps: { bookings: BookingRepository<Trx>; agenda: Pick<ProfessionalAgenda<Trx>, "findSpecialties"> }) {
  return {
    /** Factos da marcação do membro (criação e opções); `null` se inexistente ou de outro membro/família. */
    async getAnchorFacts(trx: Trx, familyId: string, memberId: string, bookingId: string): Promise<ShareAnchorFacts | null> {
      const booking = await deps.bookings.findForFamily(trx, familyId, memberId, bookingId, false);
      if (!booking) return null;
      const [specialty] = await deps.agenda.findSpecialties([booking.specialtyId]);
      if (!specialty) return null;
      return {
        professionalId: booking.professionalId,
        status: booking.status,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        participantLabel: booking.participantLabel,
        professionalCategory: specialty.category,
      };
    },
    /** Estado atual para a reavaliação a cada abertura (BR-MKT-70); `null` se a marcação não existir ou não for deste profissional. */
    async getAnchorStatus(trx: Trx, bookingId: string, professionalId: string): Promise<ShareAnchorStatus | null> {
      const booking = await deps.bookings.findForProfessional(trx, professionalId, bookingId, false);
      return booking ? { status: booking.status } : null;
    },
  };
}
