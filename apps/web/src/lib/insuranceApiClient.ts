import { AppError } from './errors'
import { apiBaseUrl, toErrorCode, type Problem } from './apiClient'
import type { InsuranceRole } from '@/types/insurance'

/**
 * Cliente HTTP do **portal da seguradora** (`/insurance-portal/*`, ADR-021).
 *
 * Separado de `apiClient.ts` e de `clinicApiClient.ts`: `InsuranceAccount` é um terceiro espaço de
 * identidade (claims `iid`/`isid`, cookie `insurance_refresh_token`). O token vive só em memória,
 * numa variável que nenhum outro cliente lê, e nunca é aceite nas rotas de família ou da clínica.
 */
let insuranceAccessToken: string | null = null

export function setInsuranceAccessToken(token: string | null) {
  insuranceAccessToken = token
}

/** `InsuranceTokenResponse` (openapi.yaml). */
export interface InsuranceTokenResponse {
  accessToken: string
  expiresIn: number
  insurerId: string
  role: InsuranceRole
}

export async function insuranceApiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const baseUrl = apiBaseUrl()
  if (!baseUrl) throw new Error('VITE_API_URL não está configurado.')

  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.auth !== false && insuranceAccessToken) headers.Authorization = `Bearer ${insuranceAccessToken}`

  const res = await fetch(`${baseUrl}/insurance-portal${path}`, {
    method: options.method ?? 'GET',
    headers,
    // Envia/recebe o cookie `insurance_refresh_token` (HttpOnly, caminho próprio do portal).
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

/** `POST /insurance-portal/auth/refresh` (cookie `insurance_refresh_token`); `null` se não houver sessão. */
export async function refreshInsuranceAccessToken(): Promise<InsuranceTokenResponse | null> {
  try {
    const tokens = await insuranceApiFetch<InsuranceTokenResponse>('/auth/refresh', { method: 'POST', auth: false })
    setInsuranceAccessToken(tokens.accessToken)
    return tokens
  } catch {
    return null
  }
}
