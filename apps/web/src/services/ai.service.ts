import { apiFetch, hasApiBackend } from '@/lib/apiClient'
import { isAppError } from '@/lib/errors'
import { listManagedMembers } from '@/mocks/handlers/family'
import * as mock from '@/mocks/handlers/ai'
import type { AiConsent, AiGuardrails, AiOutcome, AiProviderId, AiSession, AiSessionInput } from '@/types/ai'

/**
 * Assistente de IA (M18, ADR-039): só a parte do SERVIDOR (guardrails, consentimentos, sessão com contexto minimizado, desfecho). A chamada ao
 * fornecedor é feita no dispositivo (`lib/ai`). Sem `VITE_API_URL` usa o mock. Com a flag desligada no servidor (`AI_ASSISTANT_ENABLED=false`)
 * as rotas respondem 404 e o assistente nem aparece (`isEnabled`).
 */
const base = (familyId: string, memberId: string) => `/families/${encodeURIComponent(familyId)}/members/${encodeURIComponent(memberId)}/ai`

const apiImpl = {
  getGuardrails: () => apiFetch<AiGuardrails>('/ai/guardrails'),
  listConsents: (familyId: string, memberId: string) => apiFetch<AiConsent[]>(`${base(familyId, memberId)}/consents`),
  grantConsent: (familyId: string, memberId: string, provider: AiProviderId, consentVersion: string) =>
    apiFetch<AiConsent>(`${base(familyId, memberId)}/consents/${provider}`, { method: 'PUT', body: { consentVersion } }),
  revokeConsent: (familyId: string, memberId: string, provider: AiProviderId) => apiFetch<void>(`${base(familyId, memberId)}/consents/${provider}`, { method: 'DELETE' }),
  createSession: (familyId: string, memberId: string, input: AiSessionInput) => apiFetch<AiSession>(`${base(familyId, memberId)}/sessions`, { method: 'POST', body: input }),
  reportOutcome: (familyId: string, memberId: string, sessionToken: string, outcome: AiOutcome) =>
    apiFetch<void>(`${base(familyId, memberId)}/session-outcomes`, { method: 'POST', body: { sessionToken, outcome } }),
}

const mockImpl: typeof apiImpl = {
  getGuardrails: mock.getGuardrails,
  listConsents: (_f, memberId) => mock.listConsents(memberId),
  grantConsent: (_f, memberId, provider, version) => mock.grantConsent(memberId, provider, version),
  revokeConsent: (_f, memberId, provider) => mock.revokeConsent(memberId, provider),
  createSession: (_f, memberId, input) => mock.createSession(memberId, input),
  reportOutcome: (_f, memberId, _token, outcome) => mock.reportOutcome(memberId, outcome),
}

const impl = hasApiBackend() ? apiImpl : mockImpl

/** Pessoa por quem o utilizador pode usar o assistente: ele próprio (adulto) ou um dependente de quem é tutor (BR-AI-04). */
export interface AiMember {
  id: string
  name: string
  isSelf: boolean
}

interface ApiMember {
  id: string
  name: string
  isSelf: boolean
  isDependent: boolean
  status: 'ACTIVE' | 'BLOCKED'
  guardianIds?: string[]
}

async function eligibleMembers(familyId: string, userId: string): Promise<AiMember[]> {
  if (!hasApiBackend()) {
    const managed = await listManagedMembers(familyId, userId)
    return managed.filter((m) => m.status === 'ACTIVE' && !(m.userId === userId && m.isDependent)).map((m) => ({ id: m.id, name: m.name, isSelf: m.userId === userId }))
  }
  const members = await apiFetch<ApiMember[]>(`/families/${encodeURIComponent(familyId)}/members`)
  const selfId = members.find((m) => m.isSelf && !m.isDependent)?.id
  return members
    .filter((m) => m.status === 'ACTIVE' && ((m.isSelf && !m.isDependent) || (m.isDependent && !m.isSelf && selfId !== undefined && m.guardianIds?.includes(selfId))))
    .map((m) => ({ id: m.id, name: m.name, isSelf: m.isSelf }))
}

let enabled: Promise<boolean> | undefined

export const aiService = {
  ...impl,
  eligibleMembers,
  /** O assistente existe neste servidor? (`GET /ai/guardrails` ≠ 404). Erro de rede ⇒ não se oferece (falha fechada). */
  isEnabled(): Promise<boolean> {
    enabled ??= impl.getGuardrails().then(
      () => true,
      (error: unknown) => {
        if (!isAppError(error, 'NOT_FOUND')) enabled = undefined
        return false
      },
    )
    return enabled
  },
  resetForTests(): void {
    enabled = undefined
    mock.resetAiMock()
  },
}
