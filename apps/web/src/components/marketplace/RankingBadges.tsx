import { Badge } from '@/components/ui/Badge'
import { rankingLabelText, reasonTexts } from '@/lib/marketplace'
import type { RankingExplanation } from '@/types/marketplace'

interface RankingBadgesProps {
  ranking?: RankingExplanation
}

/** Selos do ranking: «Novo» (se aplicável) e as razões em texto neutro. Sem ranking não mostra nada. */
export function RankingBadges({ ranking }: RankingBadgesProps) {
  if (!ranking) return null
  // Rótulo desconhecido não gera selo; as razões (conjunto aberto) são mostradas só quando têm texto.
  const labelText = ranking.label === 'NEW' ? rankingLabelText.NEW : undefined
  const reasons = reasonTexts(ranking.reasons)
  if (!labelText && reasons.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5">
      {labelText && <Badge tone="primary">{labelText}</Badge>}
      {reasons.map((text) => (
        <Badge key={text}>{text}</Badge>
      ))}
    </div>
  )
}
