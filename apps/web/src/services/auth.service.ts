import * as api from '@/mocks/handlers/auth'

export type { LoginInput, RegisterInput } from '@/mocks/handlers/auth'

/**
 * Autenticação. Hoje delega no backend simulado (mocks/handlers);
 * com a API real, cada método passa a chamar /api/v1/auth/* sem mudar a assinatura.
 */
export const authService = {
  login: api.login,
  register: api.register,
  verifyEmail: api.verifyEmail,
  resendVerificationCode: api.resendVerificationCode,
  requestPasswordReset: api.requestPasswordReset,
  getUser: api.getUser,
}

/** TBD: versão dos termos/política em vigor (BR-ACC-03). */
export const TERMS_VERSION = '2026-01'
