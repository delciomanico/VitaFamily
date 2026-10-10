import * as mock from '@/mocks/handlers/auth'
import { apiFetch, hasApiBackend, refreshAccessToken, setAccessToken, type TokenResponse } from '@/lib/apiClient'
import type { User } from '@/types/user'

export type { LoginInput, RegisterInput } from '@/mocks/handlers/auth'
import type { LoginInput, RegisterInput } from '@/mocks/handlers/auth'

/** `/users/me` devolve `birthDate` como datetime; a UI só usa a parte da data (yyyy-mm-dd). */
interface MeResponse {
  id: string
  email: string
  name: string
  birthDate: string
  timezone: string
  status: User['status']
}

function toUser(me: MeResponse): User {
  return { ...me, birthDate: me.birthDate.slice(0, 10) }
}

async function apiLogin(input: LoginInput): Promise<User> {
  const tokens = await apiFetch<TokenResponse>('/auth/login', { method: 'POST', body: input, auth: false })
  setAccessToken(tokens.accessToken)
  return toUser(await apiFetch<MeResponse>('/users/me'))
}

/**
 * Autenticação. Com `VITE_API_URL` definido chama a API real (docs/05-api/openapi.yaml);
 * sem backend configurado, cai no backend simulado (mocks/handlers) para desenvolvimento isolado da UI.
 */
export const authService = {
  login: hasApiBackend() ? apiLogin : mock.login,

  register: hasApiBackend()
    ? (input: RegisterInput) => apiFetch<void>('/auth/register', { method: 'POST', body: input, auth: false })
    : mock.register,

  /**
   * ADR-018: código de 6 dígitos, verificado em conjunto com o `email`. A API só confirma o
   * e-mail (204, sem tokens) — por isso autentica-se logo a seguir com a password já introduzida
   * no registo, para manter o mesmo comportamento do mock (sessão iniciada após verificar).
   */
  verifyEmail: hasApiBackend()
    ? async (email: string, code: string, password: string): Promise<User> => {
        await apiFetch<void>('/auth/verify-email', { method: 'POST', body: { email, token: code }, auth: false })
        return apiLogin({ email, password })
      }
    : (email: string, code: string, _password: string) => mock.verifyEmail(email, code),

  resendVerificationCode: hasApiBackend()
    ? (email: string) => apiFetch<void>('/auth/resend-verification', { method: 'POST', body: { email }, auth: false })
    : mock.resendVerificationCode,

  requestPasswordReset: hasApiBackend()
    ? (email: string) => apiFetch<void>('/auth/password/forgot', { method: 'POST', body: { email }, auth: false })
    : mock.requestPasswordReset,

  /**
   * Restaura a sessão ao abrir a app. No mock, `userId` vem de `sessionStore` (localStorage);
   * na API real a sessão vive no cookie `refresh_token` — `userId` é ignorado.
   */
  getUser: hasApiBackend()
    ? async (_userId: string): Promise<User | null> => {
        const token = await refreshAccessToken()
        if (!token) return null
        try {
          return toUser(await apiFetch<MeResponse>('/users/me'))
        } catch {
          return null
        }
      }
    : mock.getUser,

  logout: hasApiBackend()
    ? async () => {
        try {
          await apiFetch<void>('/auth/logout', { method: 'POST' })
        } finally {
          setAccessToken(null)
        }
      }
    : () => {
        setAccessToken(null)
        return Promise.resolve()
      },
}

/** TBD: versão dos termos/política em vigor (BR-ACC-03). */
export const TERMS_VERSION = '2026-01-01'
