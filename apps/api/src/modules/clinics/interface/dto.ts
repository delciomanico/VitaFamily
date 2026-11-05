// Mapeamento de `Clinic`/`ClinicAccount`/`ClinicSlot` (application) -> forma da API
// (components.schemas, openapi.yaml).
import type { ClinicSlotView } from "../application/clinic-slots.js";
import type { Clinic, ClinicAccount, ClinicSlot } from "../application/ports.js";

export function toClinicResponse(clinic: Clinic) {
  return {
    id: clinic.id,
    name: clinic.name,
    address: clinic.address ?? null,
    phone: clinic.phone ?? null,
    email: clinic.email ?? null,
    type: clinic.type,
    status: clinic.status,
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
