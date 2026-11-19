import { AppError } from '@/lib/errors'
import type {
  ComparisonItem,
  MarketplaceFilters,
  MarketplaceOffer,
  MarketplaceProfessionalItem,
  MarketplaceProfessionalPage,
  MarketplaceProfessionalProfile,
  MarketplaceSearchParams,
  MarketplaceSort,
  ProfessionalComparison,
  RankingExplanation,
  RankingRules,
  ReviewSummary,
} from '@/types/marketplace'
import type { OfferMethod, ProfessionalOffer, Specialty } from '@/types/professional'
import { reviewStats } from '../consultationsDb'
import { marketplaceDb } from '../marketplaceDb'
import { professionalDb } from '../professionalDb'
import { respond } from '../respond'

/*
 * Descoberta (`/marketplace/*`, MK2, BR-MKT-32..37, 49). Exige login de `User`; nada é gravado.
 * Só profissionais `APPROVED` com ≥ 1 oferta ativa; nunca e-mail, pagamento, credenciais nem estado.
 * O ranking é uma função pura sobre a coorte da especialidade (BR-MKT-36/37).
 */

const PAGE_SIZE = 20
const DAY = 86_400_000
const MAX_PRICE = 100_000_000

/** Pesos do ranking v2 (BR-MKT-37/61, OP-103): mudar é mudança de contrato. */
export const RANKING_V2 = { reviews: 40, completeness: 20, availability: 20, price: 10, seniority: 10 } as const
/** Avaliações verificadas: mínimo para deixar de ser «Novo», peso da média da coorte (suavização) e valor neutro. */
const REVIEWS = { minCount: 3, priorWeight: 5, neutral: 0.5, fallbackMean: 3 } as const

interface DiscoveryProfessional {
  id: string
  displayName: string
  city: string
  bio?: string
  specialtyIds: string[]
  offers: ProfessionalOffer[]
  approvedAt: string
  nextAt: (offerId: string) => string | undefined
}

/** Profissionais visíveis: `APPROVED` com ≥ 1 oferta ativa (lê o estado a cada pedido, como o servidor). */
function visible(): DiscoveryProfessional[] {
  const now = Date.now()
  const fromAccounts: DiscoveryProfessional[] = professionalDb.professionals
    .filter((p) => p.verified && p.validationStatus === 'APPROVED' && p.displayName && p.city !== undefined)
    .map((p) => ({
      id: p.id,
      displayName: p.displayName as string,
      city: p.city as string,
      bio: p.bio,
      specialtyIds: p.specialtyIds,
      offers: p.offers,
      approvedAt: p.approvedAt ?? p.createdAt,
      nextAt: (offerId: string) =>
        p.slots
          .filter((s) => s.offerId === offerId && Date.parse(s.startsAt) > now)
          .map((s) => s.startsAt)
          .sort()[0],
    }))
  const extras: DiscoveryProfessional[] = marketplaceDb.catalogExtras.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    city: p.city,
    bio: p.bio,
    specialtyIds: p.specialtyIds,
    offers: p.offers,
    approvedAt: p.approvedAt,
    nextAt: () => (p.nextAvailableInDays === undefined ? undefined : new Date(now + p.nextAvailableInDays * DAY).toISOString()),
  }))
  return [...fromAccounts, ...extras].filter((p) => p.offers.some((o) => o.active))
}

/** Estado de validação atual de um profissional (para o chat): extras são sempre `APPROVED`. */
export function isApprovedProfessional(professionalId: string): boolean {
  return visible().some((p) => p.id === professionalId)
}

export function publicProfessionalName(professionalId: string): { id: string; displayName: string; city?: string } | null {
  const account = professionalDb.professionals.find((p) => p.id === professionalId && p.displayName)
  if (account) return { id: account.id, displayName: account.displayName as string, city: account.city }
  const extra = marketplaceDb.catalogExtras.find((p) => p.id === professionalId)
  return extra ? { id: extra.id, displayName: extra.displayName, city: extra.city } : null
}

const specialtyOf = (id: string): Specialty | undefined => {
  const s = professionalDb.specialties.find((x) => x.id === id && x.active)
  return s ? { id: s.id, name: s.name, category: s.category } : undefined
}

const specialtiesOf = (p: DiscoveryProfessional): Specialty[] =>
  p.specialtyIds.map(specialtyOf).filter((s): s is Specialty => s !== undefined)

const toOffer = ({ id, specialtyId, method, durationMinutes, priceKz, note }: ProfessionalOffer): MarketplaceOffer => ({
  id,
  specialtyId,
  method,
  durationMinutes,
  priceKz,
  note,
})

const activeOffers = (p: DiscoveryProfessional, specialtyId?: string) =>
  p.offers.filter((o) => o.active && (specialtyId === undefined || o.specialtyId === specialtyId))

// ───── Ranking v2 (função pura; pagamento, destaques e ordem manual não entram) ─────

interface Scored {
  id: string
  score: number
  explanation: RankingExplanation
  availability: number
  approvedAt: string
}

export function rankCohort(cohort: DiscoveryProfessional[], specialtyId: string, now: number): Map<string, Scored> {
  const stats = new Map(cohort.map((p) => [p.id, reviewStats(p.id, specialtyId)]))
  const totalCount = [...stats.values()].reduce((sum, x) => sum + x.count, 0)
  const cohortMean = totalCount === 0 ? REVIEWS.fallbackMean : [...stats.values()].reduce((sum, x) => sum + x.sum, 0) / totalCount
  const lowest = new Map(cohort.map((p) => [p.id, Math.min(...activeOffers(p, specialtyId).map((o) => o.priceKz))]))
  const result = new Map<string, Scored>()
  for (const p of cohort) {
    const offers = activeOffers(p, specialtyId)
    const bio = p.bio?.trim() ?? ''
    const completeness =
      ((bio.length >= 80 ? 40 : bio.length >= 1 ? 20 : 0) +
        (offers.some((o) => o.note) ? 20 : 0) +
        (new Set(offers.map((o) => o.method)).size >= 2 ? 20 : 0) +
        (offers.length >= 2 ? 20 : 0)) /
      100
    const horizon = now + 14 * DAY
    const free = offers.reduce((sum, o) => {
      const next = p.nextAt(o.id)
      return sum + (next && Date.parse(next) <= horizon ? 1 : 0)
    }, 0)
    // O mock só conhece o primeiro horário por oferta: aproxima o nº de horários livres.
    const availability = Math.min(free * 10, 20) / 20
    const mine = lowest.get(p.id) as number
    const others = cohort.filter((o) => o.id !== p.id).map((o) => lowest.get(o.id) as number)
    const price =
      cohort.length >= 3
        ? 1 - (others.filter((x) => x < mine).length + 0.5 * others.filter((x) => x === mine).length) / (cohort.length - 1)
        : 0.5
    const seniority = Math.min(Math.max(Math.floor((now - Date.parse(p.approvedAt)) / DAY), 0), 180) / 180
    const mineStats = stats.get(p.id) as { count: number; sum: number }
    const reviews =
      mineStats.count < REVIEWS.minCount
        ? REVIEWS.neutral
        : Math.min(1, Math.max(0, ((REVIEWS.priorWeight * cohortMean + mineStats.sum) / (REVIEWS.priorWeight + mineStats.count) - 1) / 4))
    const score = Math.round(
      RANKING_V2.reviews * reviews +
        RANKING_V2.completeness * completeness +
        RANKING_V2.availability * availability +
        RANKING_V2.price * price +
        RANKING_V2.seniority * seniority +
        1e-9,
    )
    const reasons = (
      [
        ['GOOD_REVIEWS', mineStats.count >= REVIEWS.minCount ? reviews : 0],
        ['COMPLETE_PROFILE', completeness],
        ['GOOD_AVAILABILITY', availability],
        ['COMPETITIVE_PRICE', price],
        ['ESTABLISHED', seniority],
      ] as const
    )
      .filter(([, value]) => value >= 0.75)
      .map(([code]) => code)
      .slice(0, 3)
    result.set(p.id, {
      id: p.id,
      score,
      availability,
      approvedAt: p.approvedAt,
      explanation: {
        version: 'v2',
        score,
        signals: { reviews, profileCompleteness: completeness, availability, price, seniority },
        reasons,
        label: mineStats.count >= REVIEWS.minCount ? 'RATED' : 'NEW',
      },
    })
  }
  return result
}

/** Resumo das avaliações verificadas (BR-MKT-61): a média só existe com 3 ou mais avaliações; uma casa decimal. */
export function reviewSummaryOf(professionalId: string, specialtyId?: string): ReviewSummary {
  const { count, sum } = reviewStats(professionalId, specialtyId)
  return count >= REVIEWS.minCount ? { count, averageRating: Math.round((sum / count) * 10) / 10 } : { count }
}

const cohortOf = (specialtyId: string) => visible().filter((p) => activeOffers(p, specialtyId).length > 0)

// ───── Rotas ─────

export function getMarketplaceFilters(): Promise<MarketplaceFilters> {
  return respond(() => {
    const all = visible()
    const specialties = professionalDb.specialties
      .filter((s) => s.active)
      .map((s) => ({ id: s.id, name: s.name, category: s.category, professionalCount: all.filter((p) => activeOffers(p, s.id).length > 0).length }))
      .filter((s) => s.professionalCount > 0)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-PT'))
    const counts = new Map<string, number>()
    for (const p of all) counts.set(p.city, (counts.get(p.city) ?? 0) + 1)
    const cities = [...counts].map(([name, professionalCount]) => ({ name, professionalCount })).sort((a, b) => a.name.localeCompare(b.name, 'pt-PT'))
    const methods = [...new Set(all.flatMap((p) => activeOffers(p).map((o) => o.method)))].sort() as OfferMethod[]
    return { specialties, cities, methods }
  })
}

export function getRankingRules(): Promise<RankingRules> {
  return respond(() => ({
    version: 'v2',
    signals: [
      { code: 'REVIEWS', weightPercent: RANKING_V2.reviews, description: 'Avaliações: nota das avaliações verificadas (só de quem consultou), suavizada pela média da especialidade; com menos de 3 avaliações o profissional é «Novo» e este sinal é neutro.' },
      { code: 'PROFILE_COMPLETENESS', weightPercent: RANKING_V2.completeness, description: 'Perfil completo: apresentação preenchida, notas nas ofertas e mais do que um método ou oferta.' },
      { code: 'AVAILABILITY', weightPercent: RANKING_V2.availability, description: 'Disponibilidade: horários livres nos próximos 14 dias.' },
      { code: 'PRICE', weightPercent: RANKING_V2.price, description: 'Preço: o preço mais baixo do profissional face aos restantes da mesma especialidade.' },
      { code: 'SENIORITY', weightPercent: RANKING_V2.seniority, description: 'Antiguidade: tempo desde a aprovação do perfil na Vita Family.' },
    ],
    notUsed: ['Pagamento ou subscrição', 'Destaques pagos', 'Ordem definida manualmente (nem pela equipa da Vita Family)', 'Dados pessoais, nome ou cidade do profissional'],
    statement: 'O pagamento e os destaques pagos nunca influenciam a ordem.',
  }))
}

function validateSearch(params: MarketplaceSearchParams) {
  const q = params.q?.trim()
  if (q !== undefined && q.length > 0 && (q.length < 2 || q.length > 60)) throw new AppError('VALIDATION_ERROR')
  for (const price of [params.minPriceKz, params.maxPriceKz]) {
    if (price !== undefined && (!Number.isInteger(price) || price < 0 || price > MAX_PRICE)) throw new AppError('VALIDATION_ERROR')
  }
  if (params.minPriceKz !== undefined && params.maxPriceKz !== undefined && params.minPriceKz > params.maxPriceKz) throw new AppError('VALIDATION_ERROR')
  if (params.availableWithinDays !== undefined && (params.availableWithinDays < 1 || params.availableWithinDays > 56)) throw new AppError('VALIDATION_ERROR')
  if (params.sort === 'RANKING' && !params.specialtyId) throw new AppError('VALIDATION_ERROR')
}

export function searchProfessionals(params: MarketplaceSearchParams = {}): Promise<MarketplaceProfessionalPage> {
  return respond(() => {
    validateSearch(params)
    const now = Date.now()
    const term = params.q?.trim().toLowerCase()
    const city = params.city?.trim().toLowerCase()
    const withinMs = params.availableWithinDays ? params.availableWithinDays * DAY : undefined
    const category = params.category

    const rows = visible()
      .filter((p) => !term || p.displayName.toLowerCase().includes(term))
      .filter((p) => !city || p.city.trim().toLowerCase() === city)
      .map((p) => {
        // Todos os filtros de oferta aplicam-se à MESMA oferta (BR-MKT-33).
        const matching = activeOffers(p).filter((o) => {
          if (params.specialtyId && o.specialtyId !== params.specialtyId) return false
          if (category && specialtyOf(o.specialtyId)?.category !== category) return false
          if (params.method && o.method !== params.method) return false
          if (params.minPriceKz !== undefined && o.priceKz < params.minPriceKz) return false
          if (params.maxPriceKz !== undefined && o.priceKz > params.maxPriceKz) return false
          if (withinMs !== undefined) {
            const next = p.nextAt(o.id)
            if (!next || Date.parse(next) > now + withinMs) return false
          }
          return true
        })
        return { p, matching }
      })
      .filter((row) => row.matching.length > 0)

    const ranks = params.specialtyId ? rankCohort(cohortOf(params.specialtyId), params.specialtyId, now) : undefined
    const items = rows.map(({ p, matching }) => {
      const nexts = matching.map((o) => p.nextAt(o.id)).filter((x): x is string => Boolean(x)).sort()
      const item: MarketplaceProfessionalItem = {
        id: p.id,
        displayName: p.displayName,
        city: p.city,
        specialties: specialtiesOf(p),
        matchingOffers: matching.map(toOffer),
        fromPriceKz: Math.min(...matching.map((o) => o.priceKz)),
        nextAvailableAt: nexts[0],
        ranking: ranks?.get(p.id)?.explanation,
        reviewSummary: reviewSummaryOf(p.id, params.specialtyId),
      }
      return item
    })

    const sort: MarketplaceSort = params.sort ?? (params.specialtyId ? 'RANKING' : 'NEXT_AVAILABLE')
    const byId = (a: MarketplaceProfessionalItem, b: MarketplaceProfessionalItem) => a.id.localeCompare(b.id)
    items.sort((a, b) => {
      let diff = 0
      if (sort === 'RANKING') {
        const ra = ranks?.get(a.id)
        const rb = ranks?.get(b.id)
        diff = (rb?.score ?? 0) - (ra?.score ?? 0) || (rb?.explanation.signals.reviews ?? 0) - (ra?.explanation.signals.reviews ?? 0) || (rb?.availability ?? 0) - (ra?.availability ?? 0) || (ra?.approvedAt ?? '').localeCompare(rb?.approvedAt ?? '')
      } else if (sort === 'PRICE_ASC') diff = a.fromPriceKz - b.fromPriceKz
      else if (sort === 'PRICE_DESC') diff = b.fromPriceKz - a.fromPriceKz
      else diff = (a.nextAvailableAt ?? '9999').localeCompare(b.nextAvailableAt ?? '9999')
      return diff || byId(a, b)
    })

    const limit = Math.min(params.limit ?? PAGE_SIZE, 50)
    const start = params.cursor ? Number(params.cursor) : 0
    if (!Number.isInteger(start) || start < 0) throw new AppError('VALIDATION_ERROR')
    return { items: items.slice(start, start + limit), nextCursor: start + limit < items.length ? String(start + limit) : null }
  })
}

export function getMarketplaceProfessional(professionalId: string, specialtyId?: string): Promise<MarketplaceProfessionalProfile> {
  return respond(() => {
    const p = visible().find((x) => x.id === professionalId)
    if (!p) throw new AppError('NOT_FOUND')
    const offers = activeOffers(p)
    const nexts = offers.map((o) => p.nextAt(o.id)).filter((x): x is string => Boolean(x)).sort()
    const approved = new Date(p.approvedAt)
    const memberSince = `${approved.getUTCFullYear()}-${String(approved.getUTCMonth() + 1).padStart(2, '0')}-01`
    const ranking =
      specialtyId && p.specialtyIds.includes(specialtyId)
        ? rankCohort(cohortOf(specialtyId), specialtyId, Date.now()).get(p.id)?.explanation
        : undefined
    return {
      id: p.id,
      displayName: p.displayName,
      bio: p.bio,
      city: p.city,
      specialties: specialtiesOf(p),
      offers: offers.map(toOffer),
      nextAvailableAt: nexts[0],
      memberSince,
      ranking,
      reviewSummary: reviewSummaryOf(p.id, specialtyId && p.specialtyIds.includes(specialtyId) ? specialtyId : undefined),
    }
  })
}

export function compareProfessionals(ids: string[], specialtyId: string): Promise<ProfessionalComparison> {
  return respond(() => {
    if (ids.length < 2 || ids.length > 3 || new Set(ids).size !== ids.length || !specialtyId) throw new AppError('VALIDATION_ERROR')
    const all = visible()
    const found = ids.map((id) => all.find((p) => p.id === id))
    if (found.some((p) => !p)) throw new AppError('NOT_FOUND')
    const items: ComparisonItem[] = (found as DiscoveryProfessional[]).map((p) => {
      const offers = activeOffers(p, specialtyId)
      if (offers.length === 0) throw new AppError('VALIDATION_ERROR')
      const nexts = offers.map((o) => p.nextAt(o.id)).filter((x): x is string => Boolean(x)).sort()
      return {
        professionalId: p.id,
        displayName: p.displayName,
        city: p.city,
        offers: offers
          .map(toOffer)
          .sort((a, b) => a.method.localeCompare(b.method) || a.durationMinutes - b.durationMinutes),
        fromPriceKz: Math.min(...offers.map((o) => o.priceKz)),
        nextAvailableAt: nexts[0],
      }
    })
    const methods = [...new Set(items.flatMap((i) => i.offers.map((o) => o.method)))].sort()
    const priceSummary = methods.map((method) => {
      const prices = items.flatMap((i) => i.offers.filter((o) => o.method === method).map((o) => ({ id: i.professionalId, price: o.priceKz })))
      const min = Math.min(...prices.map((x) => x.price))
      return {
        method,
        minPriceKz: min,
        maxPriceKz: Math.max(...prices.map((x) => x.price)),
        cheapestProfessionalIds: [...new Set(prices.filter((x) => x.price === min).map((x) => x.id))],
      }
    })
    return { specialtyId, items, priceSummary }
  })
}
