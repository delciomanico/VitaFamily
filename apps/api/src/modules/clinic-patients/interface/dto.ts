// Mapeamento application -> forma da API (components.schemas.ClinicCalendar*, ClinicSharedHistory, …). Nunca ids Vita.
import type { CalendarEntry, CalendarFreeSlot } from "../domain/calendar.js";
import type { ClinicCalendarView, ClinicSearchView } from "../application/calendar.js";

export function toCalendarEntryResponse(entry: CalendarEntry) {
  return {
    id: entry.id,
    source: entry.source,
    kind: entry.kind,
    status: entry.status,
    startsAt: entry.startsAt.toISOString(),
    endsAt: entry.endsAt.toISOString(),
    professionalId: entry.professionalId,
    professionalName: entry.professionalName,
    specialty: entry.specialty,
    patientName: entry.patientName,
    clinicPatientId: entry.clinicPatientId,
    slotId: entry.slotId,
    confirmationStatus: entry.confirmationStatus,
    dayState: entry.dayState,
    arrivedAt: entry.arrivedAt ? entry.arrivedAt.toISOString() : null,
    waitingMinutes: entry.waitingMinutes,
  };
}

export function toFreeSlotResponse(slot: CalendarFreeSlot) {
  return {
    slotId: slot.slotId,
    kind: slot.kind,
    startsAt: slot.startsAt.toISOString(),
    endsAt: slot.endsAt.toISOString(),
    professionalId: slot.professionalId,
    professionalName: slot.professionalName,
    specialty: slot.specialty,
    remaining: slot.remaining,
  };
}

export function toCalendarResponse(view: ClinicCalendarView) {
  return { from: view.from.toISOString(), to: view.to.toISOString(), entries: view.entries.map(toCalendarEntryResponse), freeSlots: view.freeSlots.map(toFreeSlotResponse) };
}

export function toSearchResponse(view: ClinicSearchView) {
  return { patients: view.patients, bookings: view.bookings.map(toCalendarEntryResponse) };
}

/** `ClinicBooking`/`ClinicExamBooking`/`ClinicRecommendation` da ficha: campos opcionais ausentes saem como `null`. */
export function toRecordResponse<
  B extends { specialty?: string; professionalName?: string; notes?: string; responseNote?: string; slotId?: string; confirmationSource?: string; arrivedAt?: string; startedAt?: string; waitingMinutes?: number; followUpDueOn?: string },
  E extends { examType?: string; professionalName?: string; notes?: string; responseNote?: string; slotId?: string },
  R extends { appointmentId?: string; examinationId?: string },
>(record: { patient: unknown; bookings: B[]; examinations: E[]; recommendations: R[] }) {
  return {
    patient: record.patient,
    bookings: record.bookings.map((b) => ({
      ...b,
      specialty: b.specialty ?? null,
      professionalName: b.professionalName ?? null,
      notes: b.notes ?? null,
      responseNote: b.responseNote ?? null,
      slotId: b.slotId ?? null,
      confirmationSource: b.confirmationSource ?? null,
      arrivedAt: b.arrivedAt ?? null,
      startedAt: b.startedAt ?? null,
      waitingMinutes: b.waitingMinutes ?? null,
      followUpDueOn: b.followUpDueOn ?? null,
    })),
    examinations: record.examinations.map((e) => ({ ...e, examType: e.examType ?? null, professionalName: e.professionalName ?? null, notes: e.notes ?? null, responseNote: e.responseNote ?? null, slotId: e.slotId ?? null })),
    recommendations: record.recommendations.map((r) => ({ ...r, appointmentId: r.appointmentId ?? null, examinationId: r.examinationId ?? null })),
  };
}
