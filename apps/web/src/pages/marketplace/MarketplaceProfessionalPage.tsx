import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { UserX } from 'lucide-react'
import { Page } from '@/components/layout/Page'
import { BookingModal } from '@/components/consultations/BookingModal'
import { ProfessionalReviews } from '@/components/consultations/ProfessionalReviews'
import { RatingSummary } from '@/components/consultations/Stars'
import { RankingBadges } from '@/components/marketplace/RankingBadges'
import { StartConversationModal } from '@/components/marketplace/StartConversationModal'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, Section } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useAsync } from '@/hooks/useAsync'
import { usePageTitle } from '@/hooks/usePageTitle'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatWhenLuanda, LUANDA_TZ } from '@/lib/format'
import { categoryNotice } from '@/lib/marketplace'
import { categoryLabel, formatKz, offerMethodLabel } from '@/lib/professional'
import { paths } from '@/routes/paths'
import { marketplaceService } from '@/services/marketplace.service'

const memberSinceFormat = new Intl.DateTimeFormat('pt-AO', { month: 'long', year: 'numeric', timeZone: LUANDA_TZ })

/** «março de 2026» a partir de `AAAA-MM-DD` (primeiro dia do mês da primeira aprovação). */
function memberSinceLabel(value: string): string {
  const [year = 1970, month = 1] = value.split('-').map(Number)
  // Meio-dia UTC: continua no mesmo mês em qualquer fuso.
  return memberSinceFormat.format(new Date(Date.UTC(year, month - 1, 15, 12)))
}

/** Perfil público de um profissional do mercado (`/marketplace/profissional/:id`). */
export function MarketplaceProfessionalPage() {
  const { professionalId = '' } = useParams()
  const [params] = useSearchParams()
  const specialtyParam = params.get('especialidade') ?? ''
  const [writing, setWriting] = useState(false)
  const [booking, setBooking] = useState(false)
  const { state, reload } = useAsync(
    () => marketplaceService.get(professionalId, specialtyParam || undefined),
    [professionalId, specialtyParam],
  )
  const profile = state.status === 'success' ? state.data : null
  usePageTitle(profile?.displayName)

  if (state.status === 'loading') {
    return (
      <Page title="Profissional" backTo={paths.marketplace}>
        <LoadingState rows={3} />
      </Page>
    )
  }

  if (state.status === 'error') {
    return (
      <Page title="Profissional" backTo={paths.marketplace}>
        {isAppError(state.error, 'NOT_FOUND') ? (
          <EmptyState icon={UserX} title="Profissional não encontrado" />
        ) : (
          <ErrorState message={errorMessage(state.error)} onRetry={reload} />
        )}
      </Page>
    )
  }

  const p = state.data
  const categories = [...new Set(p.specialties.map((specialty) => specialty.category))]
  const specialtyName = (id: string) => p.specialties.find((specialty) => specialty.id === id)?.name ?? 'Especialidade'
  const firstSpecialty = p.specialties[0]
  const compareParams = new URLSearchParams(firstSpecialty ? { especialidade: firstSpecialty.id } : {})
  const compareTo = compareParams.toString() ? `${paths.marketplace}?${compareParams.toString()}` : paths.marketplace

  return (
    <Page title={p.displayName} backTo={paths.marketplace}>
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="success">Validado</Badge>
          <RankingBadges ranking={p.ranking} />
        </div>
        <RatingSummary summary={p.reviewSummary} showNew={!p.ranking} />
        <p className="text-sm text-muted">{p.city}</p>
        {p.memberSince && <p className="text-sm text-muted">Membro desde {memberSinceLabel(p.memberSince)}</p>}
        {p.bio && <p className="text-sm whitespace-pre-line">{p.bio}</p>}
      </Card>

      <Section title="Especialidades">
        <p className="text-sm">{p.specialties.map((specialty) => specialty.name).join(', ') || 'Sem especialidades'}</p>
        {categories.map((category) => (
          <p key={category} className="text-sm text-muted">
            <span className="font-medium">{categoryLabel[category]}:</span> {categoryNotice[category]}
          </p>
        ))}
      </Section>

      <Section title="Disponibilidade">
        <p className="text-sm">
          <span className="text-muted">Próxima disponibilidade: </span>
          {p.nextAvailableAt ? formatWhenLuanda(p.nextAvailableAt) : 'Sem horários livres'}
        </p>
      </Section>

      <Section title="Ofertas">
        {p.offers.length > 0 ? (
          <Card className="py-1">
            <ul className="divide-y divide-border">
              {p.offers.map((offer) => (
                <li key={offer.id} className="flex flex-col gap-1 py-3">
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-medium">
                      {offerMethodLabel[offer.method]} · {offer.durationMinutes} min
                    </span>
                    <span className="font-semibold">{formatKz(offer.priceKz)}</span>
                  </span>
                  <span className="text-sm text-muted">{specialtyName(offer.specialtyId)}</span>
                  {offer.note && <span className="text-sm">{offer.note}</span>}
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <EmptyState icon={UserX} title="Sem ofertas publicadas." />
        )}
      </Section>

      <ProfessionalReviews professionalId={p.id} specialtyId={specialtyParam || undefined} />

      <div className="flex flex-col gap-3">
        <Button size="xl" onClick={() => setBooking(true)} disabled={p.offers.length === 0}>
          Marcar consulta
        </Button>
        <Button variant="secondary" size="lg" onClick={() => setWriting(true)}>
          Escrever
        </Button>
        <ButtonLink to={compareTo} variant="secondary" size="lg">
          Comparar com outros
        </ButtonLink>
      </div>

      <BookingModal
        open={booking}
        onClose={() => setBooking(false)}
        professional={{ id: p.id, displayName: p.displayName }}
        offers={p.offers}
        specialties={p.specialties}
        initialOfferId={p.offers.find((offer) => offer.specialtyId === specialtyParam)?.id}
      />

      <StartConversationModal
        open={writing}
        onClose={() => setWriting(false)}
        professional={{ id: p.id, displayName: p.displayName }}
      />
    </Page>
  )
}
