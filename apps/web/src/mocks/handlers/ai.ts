import { AppError } from '@/lib/errors'
import guardrailsFixture from '@/lib/ai/fixtures/guardrails.json'
import type { AiConsent, AiContext, AiGuardrails, AiOutcome, AiProviderId, AiSession, AiSessionInput } from '@/types/ai'

/* Backend simulado do assistente (M18): consentimentos em memória, guardrails do fixture partilhado e contexto de demonstração minimizado. */

export const mockGuardrails = guardrailsFixture as unknown as AiGuardrails

const consents = new Map<string, AiConsent>()
const outcomes: Array<{ memberId: string; outcome: AiOutcome }> = []
const key = (memberId: string, provider: AiProviderId) => `${memberId}:${provider}`

export function resetAiMock(): void {
  consents.clear()
  outcomes.length = 0
}

export const mockOutcomes = (): ReadonlyArray<{ memberId: string; outcome: AiOutcome }> => outcomes

export const getGuardrails = (): Promise<AiGuardrails> => Promise.resolve(mockGuardrails)

export function listConsents(memberId: string): Promise<AiConsent[]> {
  return Promise.resolve((['GEMINI', 'CLAUDE', 'OPENAI'] as const).flatMap((p) => consents.get(key(memberId, p)) ?? []))
}

export function grantConsent(memberId: string, provider: AiProviderId, consentVersion: string): Promise<AiConsent> {
  const current = consents.get(key(memberId, provider))
  if (current && current.revokedAt === null && current.consentVersion === consentVersion) return Promise.resolve(current)
  const consent: AiConsent = { provider, consentVersion, grantedAt: new Date().toISOString(), revokedAt: null }
  consents.set(key(memberId, provider), consent)
  return Promise.resolve(consent)
}

export function revokeConsent(memberId: string, provider: AiProviderId): Promise<void> {
  const current = consents.get(key(memberId, provider))
  if (current && current.revokedAt === null) consents.set(key(memberId, provider), { ...current, revokedAt: new Date().toISOString() })
  return Promise.resolve()
}

export function createSession(memberId: string, input: AiSessionInput): Promise<AiSession> {
  const consent = consents.get(key(memberId, input.provider))
  if (!consent || consent.revokedAt !== null) return Promise.reject(new AppError('FORBIDDEN'))
  if (input.guardrailsVersion !== mockGuardrails.version) return Promise.reject(new AppError('CONFLICT'))
  const context: AiContext =
    input.kind === 'SUMMARY'
      ? {
          ageBand: '40-64',
          adherence: [{ label: 'Medicamento A', taken: 18, notTaken: 2, unconfirmed: 1, adherencePct: 86 }],
          series: [{ parameter: 'Glicose', unit: 'mg/dL', referenceMin: 70, referenceMax: 99, points: [{ dayOffset: 10, value: 92 }, { dayOffset: 80, value: 104 }] }],
          counts: { 'exams.COMPLETED': 2 },
        }
      : { ageBand: '40-64', ...(input.includeContext ? { conditions: ['Asma'] } : {}) }
  return Promise.resolve({ sessionToken: `demo.${Math.random().toString(36).slice(2)}`, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), guardrailsVersion: mockGuardrails.version, context })
}

export function reportOutcome(memberId: string, outcome: AiOutcome): Promise<void> {
  outcomes.push({ memberId, outcome })
  return Promise.resolve()
}
