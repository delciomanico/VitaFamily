import { AppError } from './errors'
import { apiBaseUrl, toErrorCode, type Problem } from './apiClient'

/**
 * Cliente HTTP do **portal da clínica** (`/clinic-portal/*`, ADR-020).
 *
 * Deliberadamente separado de `apiClient.ts`: as contas do portal (`ClinicAccount`) são um espaço
 * de identidade distinto das contas de utilizador (`User`) — outro login, outra sessão, outro
 * token. O token de clínica tem claims próprias (`clinicAccountId`/`clinicId`/`role`) e nunca é
 * aceite nas rotas de família, nem o token de `User` nas rotas do portal; por isso também aqui
 * são duas variáveis em memória diferentes, sem qualquer ponto de partilha.
 */

/** Access token da clínica, só em memória (nunca em localStorage — authentication.md §1). */
let clinicAccessToken: string | null = null

export function setClinicAccessToken(token: string | null) {
  clinicAccessToken = token
}

export function getClinicAccessToken(): string | null {
  return clinicAccessToken
}

/** `ClinicTokenResponse` (openapi.yaml, D18). */
export interface ClinicTokenResponse {
  accessToken: string
  expiresIn: number
  clinicId: string
  role: 'CLINIC_ADMIN' | 'CLINIC_MANAGER'
}

/** Chama `/api/v1/clinic-portal/...` com o token da clínica (nunca o de `User`). */
export async function clinicApiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const baseUrl = apiBaseUrl()
  if (!baseUrl) throw new Error('VITE_API_URL não está configurado.')

  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.auth !== false && clinicAccessToken) headers.Authorization = `Bearer ${clinicAccessToken}`

  const res = await fetch(`${baseUrl}/clinic-portal${path}`, {
    method: options.method ?? 'GET',
    headers,
    // Envia/recebe o cookie `clinic_refresh_token` (HttpOnly, caminho próprio do portal).
    credentials: 'include',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  if (res.status === 204) return undefined as T

  const text = await res.text()
  const data = text ? (JSON.parse(text) as unknown) : undefined

  if (!res.ok) {
    const problem = data as Problem
    throw new AppError(toErrorCode(problem?.code ?? 'UNKNOWN'))
  }

  return data as T
}

/** `POST /clinic-portal/auth/refresh` (cookie `clinic_refresh_token`); `null` se não houver sessão. */
export async function refreshClinicAccessToken(): Promise<ClinicTokenResponse | null> {
  try {
    const tokens = await clinicApiFetch<ClinicTokenResponse>('/auth/refresh', { method: 'POST', auth: false })
    setClinicAccessToken(tokens.accessToken)
    return tokens
  } catch {
    return null
  }
}
