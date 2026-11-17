import { AppError } from './errors'
import { parseJsonBody } from './safe'
import { apiBaseUrl, toErrorCode, type Problem } from './apiClient'
import type { ProfessionalValidationStatus } from '@/types/professional'

/**
 * Cliente HTTP do **portal do profissional** (`/professional-portal/*`, ADR-037, authentication.md §5).
 *
 * Separado de `apiClient.ts` e de `clinicApiClient.ts`: `ProfessionalAccount` é um espaço de identidade
 * próprio (claims `professionalAccountId`/`professionalId`/`sid`), com cookie `professional_refresh_token`
 * (HttpOnly, caminho `/api/v1/professional-portal/auth`). O access token vive só em memória.
 */
let professionalAccessToken: string | null = null

export function setProfessionalAccessToken(token: string | null) {
  professionalAccessToken = token
}

/** `ProfessionalTokenResponse` (openapi.yaml). */
export interface ProfessionalTokenResponse {
  accessToken: string
  expiresIn: number
  professionalId: string
  validationStatus: ProfessionalValidationStatus
}

/** A API devolve `null` nos campos opcionais; a UI usa ausente (`undefined`). */
export function nullsToUndefined<T>(value: unknown): T {
  if (value === null) return undefined as T
  if (Array.isArray(value)) return value.map((item) => nullsToUndefined(item)) as T
  if (typeof value === 'object' && value !== undefined) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== null) out[key] = nullsToUndefined(item)
    }
    return out as T
  }
  return value as T
}

function problemError(data: unknown, res: Response): AppError {
  const problem = data as Problem | undefined
  const retryAfter = Number(res.headers.get('Retry-After'))
  return new AppError(toErrorCode(problem?.code ?? 'UNKNOWN'), Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined)
}

/** Chama `/api/v1/professional-portal/...` com o token do profissional (nunca o de `User` nem o da clínica). */
export async function professionalApiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean; headers?: Record<string, string> } = {},
): Promise<T> {
  const baseUrl = apiBaseUrl()
  if (!baseUrl) throw new Error('VITE_API_URL não está configurado.')

  const headers: Record<string, string> = { ...options.headers }
  const isForm = options.body instanceof FormData
  if (options.body !== undefined && !isForm) headers['Content-Type'] = 'application/json'
  const send = () => {
    if (options.auth !== false && professionalAccessToken) headers.Authorization = `Bearer ${professionalAccessToken}`
    return fetch(`${baseUrl}/professional-portal${path}`, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'include',
      body: options.body === undefined ? undefined : isForm ? (options.body as FormData) : JSON.stringify(options.body),
    })
  }

  let res = await send()
  // Access token de 15 min expirado: uma tentativa de refresh (cookie) e repete o pedido.
  if (res.status === 401 && options.auth !== false && !path.startsWith('/auth/') && (await refreshProfessionalAccessToken())) {
    res = await send()
  }

  if (res.status === 204) return undefined as T

  const data = parseJsonBody(await res.text())
  if (!res.ok) throw problemError(data, res)
  return nullsToUndefined<T>(data)
}

/** `POST /professional-portal/auth/refresh` (cookie + `X-Requested-With`); `null` se não houver sessão. */
export async function refreshProfessionalAccessToken(): Promise<ProfessionalTokenResponse | null> {
  try {
    const tokens = await professionalApiFetch<ProfessionalTokenResponse>('/auth/refresh', {
      method: 'POST',
      auth: false,
      headers: { 'X-Requested-With': 'vita' },
    })
    setProfessionalAccessToken(tokens.accessToken)
    return tokens
  } catch {
    return null
  }
}

/** Descarrega a credencial do próprio profissional. */
export async function professionalApiFetchBlob(path: string): Promise<Blob> {
  const baseUrl = apiBaseUrl()
  if (!baseUrl) throw new Error('VITE_API_URL não está configurado.')
  const res = await fetch(`${baseUrl}/professional-portal${path}`, {
    credentials: 'include',
    headers: professionalAccessToken ? { Authorization: `Bearer ${professionalAccessToken}` } : {},
  })
  if (!res.ok) throw problemError(await res.json().catch(() => undefined), res)
  return res.blob()
}
