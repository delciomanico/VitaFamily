import * as consultations from '@/mocks/handlers/consultations'
import * as mock from '@/mocks/handlers/marketplace'
import { apiFetch, hasApiBackend } from '@/lib/apiClient'
import { nullsToUndefined } from '@/lib/professionalApiClient'
import type { BookableSlot, PublicReviewPage } from '@/types/consultations'
import type {
  MarketplaceFilters,
  MarketplaceProfessionalPage,
  MarketplaceProfessionalProfile,
  MarketplaceSearchParams,
  ProfessionalComparison,
  RankingRules,
} from '@/types/marketplace'

/**
 * Descoberta de profissionais para famílias (`/marketplace/*`, MK2). Exige login de `User` e não toca
 * dados de saúde (BR-MKT-32). Com `VITE_API_URL` usa a API real; sem ele, o backend simulado.
 * Pesquisa, `q` e cidade nunca vão para logs (os pedidos levam a query só no URL).
 */
const mockImpl = {
  filters: (): Promise<MarketplaceFilters> => mock.getMarketplaceFilters(),
  rankingRules: (): Promise<RankingRules> => mock.getRankingRules(),
  search: (params?: MarketplaceSearchParams): Promise<MarketplaceProfessionalPage> => mock.searchProfessionals(params),
  get: (professionalId: string, specialtyId?: string): Promise<MarketplaceProfessionalProfile> => mock.getMarketplaceProfessional(professionalId, specialtyId),
  compare: (ids: string[], specialtyId: string): Promise<ProfessionalComparison> => mock.compareProfessionals(ids, specialtyId),
  /** Horários livres de uma oferta (MK3, UC-MKT-26): só futuros e sem marcação; omissão: 14 dias. */
  slots: (professionalId: string, offerId: string, from?: string, to?: string): Promise<BookableSlot[]> => consultations.listBookableSlots(professionalId, offerId, from, to),
  /** Avaliações verificadas e anónimas (MK3, UC-MKT-40), mais recentes primeiro. */
  reviews: (professionalId: string, specialtyId?: string, cursor?: string): Promise<PublicReviewPage> => consultations.listProfessionalReviews(professionalId, { specialtyId, cursor }),
}

const api = <T>(path: string) => apiFetch<unknown>(`/marketplace${path}`).then((data) => nullsToUndefined<T>(data))

const apiImpl: typeof mockImpl = {
  filters: () => api<MarketplaceFilters>('/filters'),
  rankingRules: () => api<RankingRules>('/ranking-rules'),
  search(params = {}) {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value))
    const text = search.toString()
    return api<MarketplaceProfessionalPage>(`/professionals${text ? `?${text}` : ''}`).then((page) => ({ items: page.items, nextCursor: page.nextCursor ?? null }))
  },
  get: (professionalId, specialtyId) =>
    api<MarketplaceProfessionalProfile>(`/professionals/${encodeURIComponent(professionalId)}${specialtyId ? `?specialtyId=${encodeURIComponent(specialtyId)}` : ''}`),
  compare: (ids, specialtyId) =>
    api<ProfessionalComparison>(`/professionals/compare?ids=${ids.map(encodeURIComponent).join(',')}&specialtyId=${encodeURIComponent(specialtyId)}`),
  slots(professionalId, offerId, from, to) {
    const search = new URLSearchParams({ offerId })
    if (from) search.set('from', from)
    if (to) search.set('to', to)
    return api<BookableSlot[]>(`/professionals/${encodeURIComponent(professionalId)}/slots?${search}`)
  },
  reviews(professionalId, specialtyId, cursor) {
    const search = new URLSearchParams()
    if (specialtyId) search.set('specialtyId', specialtyId)
    if (cursor) search.set('cursor', cursor)
    const text = search.toString()
    return api<PublicReviewPage>(`/professionals/${encodeURIComponent(professionalId)}/reviews${text ? `?${text}` : ''}`).then((page) => ({ ...page, nextCursor: page.nextCursor ?? null }))
  },
}

export const marketplaceService = hasApiBackend() ? apiImpl : mockImpl
