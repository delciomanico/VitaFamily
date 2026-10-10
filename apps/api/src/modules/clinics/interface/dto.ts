// Mapeamento de `Clinic` (application) -> forma da API (components.schemas.Clinic, openapi.yaml).
import type { Clinic } from "../application/ports.js";

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
