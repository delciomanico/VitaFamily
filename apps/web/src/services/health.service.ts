import * as api from '@/mocks/handlers/health'

export type { HealthProfileInput } from '@/mocks/handlers/health'

/** Perfil de saúde e histórico médico. Hoje mock; depois /api/v1/families/{id}/members/{id}/*. */
export const healthService = {
  getHealthProfile: api.getHealthProfile,
  saveHealthProfile: api.saveHealthProfile,
  getMedicalHistory: api.getMedicalHistory,
}
