import * as api from '@/mocks/handlers/medications'

export type { UpdateMedicationInput } from '@/mocks/handlers/medications'

/** Medicamentos (planos de toma). Hoje mock; depois /api/v1/families/{id}/members/{id}/medication-plans. */
export const medicationService = {
  listMedications: api.listMedications,
  getMedication: api.getMedication,
  updateMedication: api.updateMedication,
  endMedication: api.endMedication,
}
