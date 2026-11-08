// Mapeamento de `Clinic`/`ClinicAccount`/`ClinicSlot` (application) -> forma da API
// (components.schemas, openapi.yaml).
import type { ClinicServiceTypeView } from "../application/clinic-catalog.js";
import type { ClinicScheduleRuleResult } from "../application/clinic-schedule-rules.js";
import type { ClinicSlotView } from "../application/clinic-slots.js";
import type { ClinicTimeOffBookedSlot, ClinicTimeOffResult, ClinicTimeOffView } from "../application/clinic-time-off.js";
import type { Clinic, ClinicAccount, ClinicProfessional, ClinicScheduleRule, ClinicSlot } from "../application/ports.js";
import type { ScheduleGeneration } from "../domain/clinic-schedule.js";

export function toClinicResponse(clinic: Clinic) {
  return {
    id: clinic.id,
    name: clinic.name,
    address: clinic.address ?? null,
    phone: clinic.phone ?? null,
    email: clinic.email ?? null,
    type: clinic.type,
    status: clinic.status,
    // M14 R (BR-CLN-38): perfil institucional visível ao paciente na app.
    displayName: clinic.displayName ?? null,
    description: clinic.description ?? null,
    openingHours: clinic.openingHours ?? null,
  };
}

export function toClinicListResponse(clinics: Clinic[]) {
  return clinics.map(toClinicResponse);
}

/** `components.schemas.ClinicAccount` (D18): nunca inclui `passwordHash`. */
export function toClinicAccountResponse(account: ClinicAccount) {
  return {
    id: account.id,
    clinicId: account.clinicId,
    email: account.email,
    role: account.role,
    ...(account.professionalId ? { professionalId: account.professionalId } : {}),
    status: account.status,
  };
}

export function toClinicAccountListResponse(accounts: ClinicAccount[]) {
  return accounts.map(toClinicAccountResponse);
}

/** `components.schemas.ClinicSlot` (Fase C). */
export function toClinicSlotResponse(slot: ClinicSlot) {
  return {
    id: slot.id,
    clinicId: slot.clinicId,
    kind: slot.kind,
    specialty: slot.specialty,
    professionalName: slot.professionalName ?? null,
    startsAt: slot.startsAt.toISOString(),
    durationMinutes: slot.durationMinutes,
    capacity: slot.capacity,
    professionalId: slot.professionalId ?? null,
    serviceTypeId: slot.serviceTypeId ?? null,
    scheduleRuleId: slot.scheduleRuleId ?? null,
  };
}

export function toClinicSlotListResponse(slots: ClinicSlot[]) {
  return slots.map(toClinicSlotResponse);
}

/** `components.schemas.ClinicSlotView` (BR-APT-11): `ClinicSlot` + `bookedCount`/`remaining`/`state`. */
export function toClinicSlotViewResponse(slot: ClinicSlotView) {
  return { ...toClinicSlotResponse(slot), bookedCount: slot.bookedCount, remaining: slot.remaining, state: slot.state };
}

export function toClinicSlotViewListResponse(slots: ClinicSlotView[]) {
  return slots.map(toClinicSlotViewResponse);
}

/** `components.schemas.ClinicProfessional` (BR-CLN-11). */
export function toClinicProfessionalResponse(professional: ClinicProfessional) {
  return { id: professional.id, name: professional.name, specialty: professional.specialty, active: professional.active };
}

/** `components.schemas.ClinicServiceType` (BR-CLN-12): `currency` é a da clínica, só leitura. */
export function toClinicServiceTypeResponse(service: ClinicServiceTypeView) {
  return {
    id: service.id,
    name: service.name,
    kind: service.kind,
    durationMinutes: service.durationMinutes,
    priceMinor: service.priceMinor,
    currency: service.currency,
    active: service.active,
  };
}

/** `components.schemas.ClinicScheduleRule`. */
export function toClinicScheduleRuleResponse(rule: ClinicScheduleRule) {
  return {
    id: rule.id,
    professionalId: rule.professionalId,
    serviceTypeId: rule.serviceTypeId,
    weekdays: rule.weekdays,
    startTime: rule.startTime,
    endTime: rule.endTime,
    validFrom: rule.validFrom,
    validUntil: rule.validUntil,
    capacity: rule.capacity,
    active: rule.active,
  };
}

/** `components.schemas.ClinicScheduleGeneration`: só contagens. */
export function toScheduleGenerationResponse(generation: ScheduleGeneration) {
  return {
    created: generation.created,
    unchanged: generation.unchanged,
    removed: generation.removed,
    skippedOverlap: generation.skippedOverlap,
    skippedTimeOff: generation.skippedTimeOff,
    keptBooked: generation.keptBooked,
  };
}

export function toClinicScheduleRuleResultResponse(result: ClinicScheduleRuleResult) {
  return { rule: toClinicScheduleRuleResponse(result.rule), generation: toScheduleGenerationResponse(result.generation) };
}

/** `components.schemas.ClinicTimeOff`. */
export function toClinicTimeOffResponse(timeOff: ClinicTimeOffView) {
  return {
    id: timeOff.id,
    professionalId: timeOff.professionalId,
    startsAt: timeOff.startsAt.toISOString(),
    endsAt: timeOff.endsAt.toISOString(),
    reason: timeOff.reason,
    bookedSlotCount: timeOff.bookedSlotCount,
  };
}

function toBookedSlotResponse(slot: ClinicTimeOffBookedSlot) {
  return { slotId: slot.slotId, kind: slot.kind, startsAt: slot.startsAt.toISOString(), durationMinutes: slot.durationMinutes, bookedCount: slot.bookedCount };
}

/** `components.schemas.ClinicTimeOffResult`: `bookedSlots` sem dados do paciente. */
export function toClinicTimeOffResultResponse(result: ClinicTimeOffResult) {
  return { timeOff: toClinicTimeOffResponse(result.timeOff), removedSlots: result.removedSlots, bookedSlots: result.bookedSlots.map(toBookedSlotResponse) };
}
