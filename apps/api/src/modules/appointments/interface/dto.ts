// Mapeamento de `Appointment` (application) -> forma da API (components.schemas.Appointment,
// openapi.yaml). `outcomeRequestedAt` não é exposto (não faz parte do contrato — campo interno
// para `alerts`, M8, ver `domain/appointment.ts`).
import type { ClinicAppointmentView } from "../application/clinic-appointments.js";
import type { Appointment, ClinicSlotLite, CursorPage } from "../application/ports.js";

export function toAppointmentResponse(appointment: Appointment) {
  return {
    id: appointment.id,
    memberId: appointment.memberId,
    scheduledAt: appointment.scheduledAt.toISOString(),
    status: appointment.status,
    professionalName: appointment.professionalName ?? null,
    clinicId: appointment.clinicId ?? null,
    clinicName: appointment.clinicName ?? null,
    slotId: appointment.slotId ?? null,
    responseNote: appointment.responseNote ?? null,
    specialty: appointment.specialty ?? null,
    reason: appointment.reason ?? null,
    notes: appointment.notes ?? null,
  };
}

export function toAppointmentPage(page: CursorPage<Appointment>) {
  return { items: page.items.map(toAppointmentResponse), nextCursor: page.nextCursor };
}

/** `components.schemas.AvailableSlot` (openapi.yaml, D17): `clinicName` vem do pedido (já
 * validado por `getBookableClinic` em `list-available-slots.ts`), não do próprio `ClinicSlotLite`. */
export function toAvailableSlotResponse(slot: ClinicSlotLite, clinicName: string) {
  return {
    id: slot.id,
    clinicId: slot.clinicId,
    clinicName,
    specialty: slot.specialty,
    professionalName: slot.professionalName ?? null,
    startsAt: slot.startsAt.toISOString(),
    durationMinutes: slot.durationMinutes,
  };
}

export function toAvailableSlotListResponse(slots: ClinicSlotLite[], clinicName: string) {
  return slots.map((slot) => toAvailableSlotResponse(slot, clinicName));
}

/** `components.schemas.ClinicBooking` (openapi.yaml, D17/BR-CLN-03): mínimo necessário, nunca o
 * `Appointment` completo. */
export function toClinicAppointmentResponse(view: ClinicAppointmentView) {
  return {
    id: view.id,
    status: view.status,
    scheduledAt: view.scheduledAt,
    specialty: view.specialty ?? null,
    professionalName: view.professionalName ?? null,
    patientName: view.patientName,
    notes: view.notes ?? null,
    responseNote: view.responseNote ?? null,
  };
}

export function toClinicAppointmentListResponse(views: ClinicAppointmentView[]) {
  return views.map(toClinicAppointmentResponse);
}
