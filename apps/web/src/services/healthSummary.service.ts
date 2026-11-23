import { apiFetch, hasApiBackend } from '@/lib/apiClient'
import * as api from '@/mocks/handlers/healthSummary'
import type { FamilyHealthSummary, HealthSummary } from '@/types/healthSummary'
import type { ReportPeriod } from '@/types/report'

type Period = Partial<ReportPeriod>

function query(period: Period): string {
  const params = new URLSearchParams()
  if (period.from) params.set('from', period.from)
  if (period.to) params.set('to', period.to)
  const text = params.toString()
  return text ? `?${text}` : ''
}

/**
 * Resumo de saúde (UC-RPT-05/05b; getMemberHealthSummary / getFamilyHealthSummary). O cálculo é do servidor
 * (ou do mock); o cliente só apresenta. Sem `VITE_API_URL` usa o mock.
 */
export const healthSummaryService = {
  getMemberSummary: hasApiBackend()
    ? (familyId: string, _userId: string, memberId: string, period: Period = {}) =>
        apiFetch<HealthSummary>(`/families/${familyId}/members/${memberId}/health-summary${query(period)}`)
    : api.getMemberHealthSummary,
  getFamilySummary: hasApiBackend()
    ? (familyId: string, _userId: string, period: Period = {}) =>
        apiFetch<FamilyHealthSummary>(`/families/${familyId}/health-summary${query(period)}`)
    : api.getFamilyHealthSummary,
}
