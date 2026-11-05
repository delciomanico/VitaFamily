import * as mock from '@/mocks/handlers/insurancePortal'
import { AppError } from '@/lib/errors'
import { hasApiBackend } from '@/lib/apiClient'
import {
  insuranceApiFetch,
  refreshInsuranceAccessToken,
  setInsuranceAccessToken,
  type InsuranceTokenResponse,
} from '@/lib/insuranceApiClient'
import { insuranceSessionStore } from '@/lib/storage'
import type {
  ClaimDecision,
  ClaimStatus,
  InsuranceAccount,
  InsuranceClaimView,
  InsuranceSession,
} from '@/types/insurance'

/**
 * Portal da seguradora (`/insurance-portal/*`, ADR-021): sessão própria, separada da de `User` e da
 * da clínica. A API só devolve `insurerId`/`role` no login; o e-mail só se conhece na aba em que se
 * fez login. O contrato não tem rota para descarregar os anexos de um pedido (OP-16).
 */
const apiImpl = {
  async login(email: string, password: string): Promise<InsuranceSession> {
    const tokens = await insuranceApiFetch<InsuranceTokenResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    })
    setInsuranceAccessToken(tokens.accessToken)
    return { insurerId: tokens.insurerId, role: tokens.role, email: email.trim().toLowerCase() }
  },

  async restore(): Promise<InsuranceSession | null> {
    const tokens = await refreshInsuranceAccessToken()
    return tokens ? { insurerId: tokens.insurerId, role: tokens.role } : null
  },

  async logout(): Promise<void> {
    try {
      await insuranceApiFetch<void>('/auth/logout', { method: 'POST' })
    } finally {
      setInsuranceAccessToken(null)
    }
  },

  listAgents: () => insuranceApiFetch<InsuranceAccount[]>('/agents'),
  createAgent: (email: string) =>
    insuranceApiFetch<InsuranceAccount>('/agents', { method: 'POST', body: { email: email.trim().toLowerCase() } }),
  removeAgent: (accountId: string) => insuranceApiFetch<void>(`/agents/${accountId}`, { method: 'DELETE' }),

  listClaims: (status?: ClaimStatus) =>
    insuranceApiFetch<InsuranceClaimView[]>(`/claims${status ? `?status=${status}` : ''}`),
  decideClaim: (claimId: string, decision: ClaimDecision, note?: string) =>
    insuranceApiFetch<InsuranceClaimView>(`/claims/${claimId}/decide`, {
      method: 'PUT',
      body: { decision, ...(note?.trim() ? { note: note.trim() } : {}) },
    }),
}

function mockAccountId(): string {
  const id = insuranceSessionStore.getAccountId()
  if (!id) throw new AppError('INVALID_CREDENTIALS')
  return id
}

const mockImpl = {
  async login(email: string, password: string): Promise<InsuranceSession> {
    const { insuranceAccountId, ...session } = await mock.insuranceLogin(email, password)
    insuranceSessionStore.setAccountId(insuranceAccountId)
    return session
  },

  async restore(): Promise<InsuranceSession | null> {
    const id = insuranceSessionStore.getAccountId()
    if (!id) return null
    const result = await mock.insuranceRefresh(id)
    if (!result) {
      insuranceSessionStore.setAccountId(null)
      return null
    }
    const { insuranceAccountId: _id, ...session } = result
    return session
  },

  logout(): Promise<void> {
    insuranceSessionStore.setAccountId(null)
    return Promise.resolve()
  },

  listAgents: () => mock.listInsuranceAgents(mockAccountId()),
  createAgent: (email: string) => mock.createInsuranceAgent(mockAccountId(), email),
  removeAgent: (accountId: string) => mock.removeInsuranceAgent(mockAccountId(), accountId),

  listClaims: (status?: ClaimStatus) => mock.listInsuranceClaims(mockAccountId(), status),
  decideClaim: (claimId: string, decision: ClaimDecision, note?: string) =>
    mock.decideInsuranceClaim(mockAccountId(), claimId, decision, note),
}

export const insurancePortalService = hasApiBackend() ? apiImpl : mockImpl
