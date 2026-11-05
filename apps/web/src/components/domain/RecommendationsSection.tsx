import { Card } from '@/components/ui/Card'
import { DetailSection } from '@/components/ui/InfoList'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { formatWhen } from '@/lib/format'
import { recommendationService, type RecommendationFilter } from '@/services/recommendation.service'

interface RecommendationsSectionProps {
  memberId: string
  origin: RecommendationFilter
}

/** Recomendações que a clínica deixou nesta consulta ou exame (só leitura). Sem nenhuma, não ocupa espaço. */
export function RecommendationsSection({ memberId, origin }: RecommendationsSectionProps) {
  const { user, family } = useAuth()
  const { state } = useAsync(
    () => recommendationService.list(family?.id ?? '', user?.id ?? '', memberId, origin),
    [family?.id, user?.id, memberId, origin.appointmentId, origin.examinationId],
  )
  if (state.status !== 'success' || state.data.length === 0) return null

  return (
    <DetailSection title="Recomendações da clínica">
      {state.data.map((r) => (
        <Card key={r.id} className="flex flex-col gap-1">
          <p className="whitespace-pre-line">{r.text}</p>
          <p className="text-xs text-muted">
            {r.clinicName} · {formatWhen(r.createdAt)}
          </p>
        </Card>
      ))}
    </DetailSection>
  )
}
