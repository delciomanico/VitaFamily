import { AppError, type ErrorCode } from './errors'

/** Backend real (docs/05-api/openapi.yaml). Sem backend configurado, cai nos mocks (ver services/*). */
const API_BASE_URL = import.meta.env.VITE_API_URL as string | undefined

/** `application/problem+json` (docs/05-api/errors.md). */
interface Problem {
  code: string
  errors?: Array<{ field: string; message: string }>
}

/** Mapeia `code` do backend (errors.md) para o `ErrorCode` da UI quando os nomes diferem. */
const CODE_MAP: Record<string, ErrorCode> = {
  AUTH_INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  UNAUTHENTICATED: 'INVALID_CREDENTIALS',
}

function toErrorCode(code: string): ErrorCode {
  const mapped = CODE_MAP[code]
  if (mapped) return mapped
  const known: ErrorCode[] = [
    'INVALID_CREDENTIALS',
    'EMAIL_NOT_VERIFIED',
    'ACCOUNT_SUSPENDED',
    'AGE_REQUIREMENT_NOT_MET',
    'PASSWORD_WEAK',
    'INVALID_CODE',
    'INVITATION_INVALID',
    'FORBIDDEN',
    'NOT_FOUND',
    'VALIDATION_ERROR',
    'CONFLICT',
    'ACCOUNT_DELETION_BLOCKED',
    'RATE_LIMITED',
  ]
  return (known as string[]).includes(code) ? (code as ErrorCode) : 'UNKNOWN'
}

/** Access token em memória (nunca em localStorage — authentication.md §1). */
let accessToken: string | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function hasApiBackend(): boolean {
  return Boolean(API_BASE_URL)
}

export interface TokenResponse {
  accessToken: string
  expiresIn: number
}

/**
 * Chama a API real. Lança `AppError` a partir de `application/problem+json` (errors.md).
 * `credentials: 'include'` envia/recebe o cookie `refresh_token` (HttpOnly, mesma origem/CORS).
 */
export async function apiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  if (!API_BASE_URL) throw new Error('VITE_API_URL não está configurado.')

  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.auth !== false && accessToken) headers.Authorization = `Bearer ${accessToken}`

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
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

/** `POST /auth/refresh` (cookie `refresh_token`); falha silenciosamente se não houver sessão. */
export async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'vita' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as TokenResponse
    setAccessToken(data.accessToken)
    return data.accessToken
  } catch {
    return null
  }
}
