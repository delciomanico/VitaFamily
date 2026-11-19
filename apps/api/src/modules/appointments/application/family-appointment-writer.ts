// Implementação da porta `FamilyAppointmentWriter` (MK3, BR-MKT-55, `modules.md` nota 37(c)): definida em `consultations/application`
// (este módulo NÃO importa `consultations`; a ligação estrutural é feita em `main/api.ts`). Corre na transação do chamador, sem
// `AccessPolicy` (quem autoriza é `consultations`) e sem `ProcessLinker.open`: a consulta usa o `Process` da marcação.
import { newId } from "../../../platform/ids/index.js";
import type { AppointmentsDeps } from "./ports.js";

export interface CreateFromBookingInput {
  bookingId: string;
  processId: string;
  familyId: string;
  memberId: string;
  startsAt: Date;
  professionalName: string;
  specialty: string;
  /** Duração copiada da marcação (omitido = 30). */
  durationMinutes?: number;
}

export interface FamilyAppointmentWriterImpl<Trx> {
  /** `SCHEDULED`, sem clínica, `booking_id`, `process_id` da marcação; idempotente por `bookingId`. Devolve o id da consulta. */
  createFromBooking(trx: Trx, input: CreateFromBookingInput): Promise<{ appointmentId: string }>;
  /** O estado da consulta segue a marcação; sem consulta (ex.: apagada pela família) não faz nada. */
  syncFromBooking(trx: Trx, input: { bookingId: string; status: "COMPLETED" | "NO_SHOW" | "CANCELLED" }): Promise<void>;
}

export function createFamilyAppointmentWriter<Trx>(deps: Pick<AppointmentsDeps<Trx>, "appointmentsRepo" | "clock">): FamilyAppointmentWriterImpl<Trx> {
  return {
    async createFromBooking(trx, input) {
      const existing = await deps.appointmentsRepo.findByBookingId(trx, input.bookingId);
      if (existing) return { appointmentId: existing.id };
      const appointment = await deps.appointmentsRepo.insert(trx, {
        id: newId(),
        familyId: input.familyId,
        memberId: input.memberId,
        scheduledAt: input.startsAt,
        status: "SCHEDULED",
        professionalName: input.professionalName,
        specialty: input.specialty,
        processId: input.processId,
        bookingId: input.bookingId,
        ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
        createdAt: deps.clock.now(),
      });
      return { appointmentId: appointment.id };
    },
    async syncFromBooking(trx, input) {
      await deps.appointmentsRepo.setStatusByBooking(trx, input.bookingId, input.status);
    },
  };
}
