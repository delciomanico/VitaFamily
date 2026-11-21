import { Link } from 'react-router-dom'
import { Star } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { formatRating } from '@/lib/consultations'
import { formatKz } from '@/lib/professional'
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

/** Avaliação em poucas palavras: «★ 4,8 (12)», «Novo» ou nada. */
function Rating({ item }: { item: MarketplaceProfessionalItem }) {
  const summary = item.reviewSummary
  if (summary?.averageRating !== undefined) {
    return (
      <span className="inline-flex items-center gap-1">
        <Star className="size-4 fill-current text-warning" aria-hidden />
        <span className="font-semibold">{formatRating(summary.averageRating)}</span>
        <span className="text-muted">({summary.count})</span>
        <span className="sr-only">avaliações de quem consultou</span>
      </span>
    )
  }
  return <span className="text-muted">Novo</span>
}

/** Linha compacta de um profissional: foto, nome, especialidade, preço e avaliação. */
export function ProfessionalCard({ item, specialtyId, selected = false, onToggleCompare, compareDisabled = false }: ProfessionalCardProps) {
  const specialties = item.specialties.map((specialty) => specialty.name).join(', ')

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface pr-3 shadow-card">
      <Link
        to={paths.marketplaceProfessional(item.id, specialtyId)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-3"
      >
        <Avatar name={item.displayName} size="lg" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-semibold">{item.displayName}</span>
          <span className="truncate text-sm text-muted">{specialties || 'Sem especialidades'}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm">
            <span className="font-semibold">{formatKz(item.fromPriceKz)}</span>
            <Rating item={item} />
          </span>
        </span>
      </Link>
      {onToggleCompare && (
        <input
          type="checkbox"
          aria-label={`Comparar ${item.displayName}`}
          checked={selected}
          disabled={compareDisabled && !selected}
          onChange={onToggleCompare}
          className="size-6 shrink-0 accent-primary"
        />
      )}
    </div>
  )
}
