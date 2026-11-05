import * as mock from '@/mocks/handlers/recommendations'
import { apiFetch, hasApiBackend } from '@/lib/apiClient'
import type { Recommendation } from '@/types/recommendation'

interface ApiRecommendation {
  id: string
  memberId: string
  appointmentId?: string | null
  examinationId?: string | null
  clinicName: string
  text: string
  createdAt: string
}

/** Filtro por origem: uma consulta ou um exame. */
export type RecommendationFilter = { appointmentId?: string; examinationId?: string }

async function apiList(familyId: string, memberId: string, filter: RecommendationFilter): Promise<Recommendation[]> {
  const params = new URLSearchParams({ limit: '100' })
  if (filter.appointmentId) params.set('appointmentId', filter.appointmentId)
  if (filter.examinationId) params.set('examinationId', filter.examinationId)
  const page = await apiFetch<{ items: ApiRecommendation[] }>(
    `/families/${familyId}/members/${memberId}/recommendations?${params}`,
  ).catch(() => ({ items: [] as ApiRecommendation[] })) // sem permissão de leitura: secção vazia
  return page.items.map((r) => ({
    id: r.id,
    memberId: r.memberId,
    appointmentId: r.appointmentId ?? undefined,
    examinationId: r.examinationId ?? undefined,
    clinicName: r.clinicName,
    text: r.text,
    createdAt: r.createdAt,
  }))
}

/** Recomendações das clínicas (só leitura para a família, BR-CLN-09). */
export const recommendationService = {
  list: (familyId: string, userId: string, memberId: string, filter: RecommendationFilter = {}) =>
    hasApiBackend() ? apiList(familyId, memberId, filter) : mock.listRecommendations(familyId, userId, memberId, filter),
}
