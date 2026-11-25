/*
 * Assistente de IA ligado pelo utilizador (M18, ADR-039; openapi → AiConsent, AiSession, AiContext, AiGuardrails).
 * A chamada ao fornecedor é feita DESTE dispositivo: o servidor só autoriza, guarda o consentimento (sem chaves) e devolve o contexto minimizado.
 */
export type AiProviderId = 'GEMINI' | 'CLAUDE' | 'OPENAI'
export type AiKind = 'SUMMARY' | 'SYMPTOMS'
export type AiOutcome = 'COMPLETED' | 'BLOCKED' | 'ALARM' | 'FAILED'
export type AiUrgency = 'NONE' | 'ROUTINE' | 'EMERGENCY'

export interface AiPattern {
  id: string
  pattern: string
  flags: string
}

export interface AiGuardrails {
  version: string
  systemInstruction: string
  blockPatterns: AiPattern[]
  alarmPatterns: AiPattern[]
  allowedSpecialties: Array<{ id: string; name: string }>
  urgencyMessage: string
  disclaimer: string
  responseSchema: Record<string, unknown>
}

export interface AiConsent {
  provider: AiProviderId
  consentVersion: string
  grantedAt: string
  revokedAt: string | null
}

export interface AiContext {
  ageBand: '0-2' | '3-12' | '13-17' | '18-39' | '40-64' | '65+'
  sex?: 'F' | 'M' | 'OTHER'
  conditions?: string[]
  adherence?: Array<{ label: string; taken: number; notTaken: number; unconfirmed: number; adherencePct?: number | null }>
  series?: Array<{ parameter: string; unit: string; referenceMin?: number | null; referenceMax?: number | null; points: Array<{ dayOffset: number; value: number }> }>
  counts?: Record<string, number>
}

export interface AiSession {
  sessionToken: string
  expiresAt: string
  guardrailsVersion: string
  context: AiContext
}

export interface AiSessionInput {
  provider: AiProviderId
  kind: AiKind
  guardrailsVersion: string
  from?: string
  to?: string
  includeContext?: boolean
}

/** Resposta do modelo depois de validada e filtrada (nunca texto cru). */
export interface AiAnswer {
  summary: string
  observations: string[]
  generalGuidance: string[]
  suggestedSpecialty?: { id: string; name: string }
  urgency: AiUrgency
}

export type AiErrorCode = 'NO_CREDENTIAL' | 'CONSENT' | 'AUTH' | 'QUOTA' | 'NETWORK' | 'RATE' | 'GUARDRAILS' | 'FAILED'

export type AiResult =
  | { kind: 'ANSWER'; answer: AiAnswer; disclaimer: string }
  | { kind: 'ALARM'; message: string }
  | { kind: 'BLOCKED'; message: string }
  | { kind: 'ERROR'; code: AiErrorCode; message: string }
