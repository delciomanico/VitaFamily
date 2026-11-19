import { Star } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatRating } from '@/lib/consultations'
import { Badge } from '@/components/ui/Badge'
import type { ReviewSummary } from '@/types/marketplace'

/** Nota de 1 a 5 em estrelas, com texto para leitores de ecrã. */
export function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span role="img" aria-label={`${rating} em 5`} className={cn('inline-flex items-center gap-0.5 text-warning', className)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn('size-4', n <= rating && 'fill-current')} aria-hidden />
      ))}
    </span>
  )
}

/**
 * Resumo das avaliações verificadas (BR-MKT-61): com menos de 3 não há média («Novo»); a nota só sai de quem consultou.
 */
export function RatingSummary({ summary, showNew = true }: { summary?: ReviewSummary; /** `false` quando o selo «Novo» já vem do ranking. */ showNew?: boolean }) {
  if (!summary) return null
  if (summary.averageRating === undefined) {
    if (!showNew && summary.count === 0) return null
    return (
      <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
        {showNew && <Badge tone="primary">Novo</Badge>}
        {summary.count > 0 && <span>{summary.count === 1 ? '1 avaliação' : `${summary.count} avaliações`}</span>}
      </span>
    )
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      <Star className="size-4 fill-current text-warning" aria-hidden />
      <span className="font-semibold">{formatRating(summary.averageRating)}</span>
      <span className="text-muted">({summary.count} avaliações de quem consultou)</span>
    </span>
  )
}
