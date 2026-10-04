import * as api from '@/mocks/handlers/health'

export type { HealthProfileInput } from '@/mocks/handlers/health'

/** Perfil de saúde (dados básicos, alergias, condições). Hoje mock; depois /api/v1. */
export const healthService = {
  getHealthProfile: api.getHealthProfile,
  saveHealthProfile: api.saveHealthProfile,
}
