import * as api from '@/mocks/handlers/clinics'

/** Clínicas parceiras e privadas da família. Hoje mock; depois /api/v1/families/{id}/clinics. */
export const clinicService = {
  listClinics: api.listClinics,
}
