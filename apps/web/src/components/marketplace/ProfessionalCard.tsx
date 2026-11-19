import { Link } from 'react-router-dom'
import { RatingSummary } from '@/components/consultations/Stars'
import { RankingBadges } from '@/components/marketplace/RankingBadges'
import { Card } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import { formatWhenLuanda } from '@/lib/format'
import { formatKz, offerMethodLabel } from '@/lib/professional'
import { paths } from '@/routes/paths'
import type { MarketplaceProfessionalItem } from '@/types/marketplace'

interface ProfessionalCardProps {
  item: MarketplaceProfessionalItem
  /** Especialidade escolhida na pesquisa (leva-a para o perfil). */
  specialtyId?: string
  selected?: boolean
  /** Presente só com especialidade escolhida: mostra a caixa «Comparar». */
  onToggleCompare?: () => void
  compareDisabled?: boolean
}

/** Cartão de um profissional na pesquisa do mercado. */
export function ProfessionalCard({ item, specialtyId, selected = false, onToggleCompare, compareDisabled = false }: ProfessionalCardProps) {
  const specialties = item.specialties.map((specialty) => specialty.name).join(', ')

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">
          <Link to={paths.marketplaceProfessional(item.id, specialtyId)} className="hover:underline">
            {item.displayName}
          </Link>
        </h2>
        <p className="text-sm text-muted">{item.city}</p>
        <p className="text-sm">{specialties || 'Sem especialidades'}</p>
      </div>

      <p className="font-semibold">A partir de {formatKz(item.fromPriceKz)}</p>

      {item.matchingOffers.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {item.matchingOffers.map((offer) => (
            <li key={offer.id}>
              {offerMethodLabel[offer.method]} · {offer.durationMinutes} min · {formatKz(offer.priceKz)}
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm">
        <span className="text-muted">Próxima disponibilidade: </span>
        {item.nextAvailableAt ? formatWhenLuanda(item.nextAvailableAt) : 'Sem horários livres'}
      </p>

      <RatingSummary summary={item.reviewSummary} showNew={!item.ranking} />
      <RankingBadges ranking={item.ranking} />

      {onToggleCompare && (
        <Checkbox
          label="Comparar"
          aria-label={`Comparar ${item.displayName}`}
          checked={selected}
          disabled={compareDisabled && !selected}
          onChange={onToggleCompare}
        />
      )}
    </Card>
  )
}
