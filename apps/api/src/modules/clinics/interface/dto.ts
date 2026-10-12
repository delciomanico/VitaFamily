// Mapeamento de `Clinic`/`ClinicAccount` (application) -> forma da API (components.schemas,
// openapi.yaml).
import type { Clinic, ClinicAccount } from "../application/ports.js";

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
