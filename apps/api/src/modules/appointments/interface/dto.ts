// Mapeamento de `Appointment` (application) -> forma da API (components.schemas.Appointment,
// openapi.yaml). `outcomeRequestedAt` não é exposto (não faz parte do contrato — campo interno
// para `alerts`, M8, ver `domain/appointment.ts`).
import type { Appointment, CursorPage } from "../application/ports.js";

export function toAppointmentResponse(appointment: Appointment) {
  return {
    id: appointment.id,
    memberId: appointment.memberId,
    scheduledAt: appointment.scheduledAt.toISOString(),
    status: appointment.status,
    professionalName: appointment.professionalName ?? null,
    clinicId: appointment.clinicId ?? null,
    clinicName: appointment.clinicName ?? null,
    reason: appointment.reason ?? null,
    notes: appointment.notes ?? null,
  };
}

export function toAppointmentPage(page: CursorPage<Appointment>) {
  return { items: page.items.map(toAppointmentResponse), nextCursor: page.nextCursor };
}
