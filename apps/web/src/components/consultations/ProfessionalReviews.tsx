import { useState } from 'react'
import { MessageSquareText } from 'lucide-react'
import { RatingSummary } from '@/components/consultations/Stars'
import { ReviewCard } from '@/components/consultations/ReviewCard'
import { Button } from '@/components/ui/Button'
import { Card, Section } from '@/components/ui/Card'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage } from '@/lib/errors'
import { marketplaceService } from '@/services/marketplace.service'
import type { PublicReview } from '@/types/consultations'

/** Avaliações verificadas de um profissional (UC-MKT-40): anónimas, mais recentes primeiro, com «Carregar mais». */
export function ProfessionalReviews({ professionalId, specialtyId }: { professionalId: string; specialtyId?: string }) {
  const toast = useToast()
  const { state, reload } = useAsync(() => marketplaceService.reviews(professionalId, specialtyId), [professionalId, specialtyId])
  const [more, setMore] = useState<{ items: PublicReview[]; nextCursor: string | null } | null>(null)
  const [loading, setLoading] = useState(false)

  if (state.status === 'loading') return <LoadingState rows={2} />
  if (state.status === 'error') return <ErrorState message={errorMessage(state.error)} onRetry={reload} />

  const page = state.data
  const items = [...page.items, ...(more?.items ?? [])]
  const nextCursor = more ? more.nextCursor : page.nextCursor

  async function loadMore() {
    if (!nextCursor) return
    setLoading(true)
    try {
      const next = await marketplaceService.reviews(professionalId, specialtyId, nextCursor)
      setMore({ items: [...(more?.items ?? []), ...next.items], nextCursor: next.nextCursor })
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Section title="Avaliações">
      <RatingSummary summary={page.summary} />
      {items.length === 0 ? (
        <EmptyState icon={MessageSquareText} title="Ainda sem avaliações." description="Só avalia quem já teve a consulta, e as avaliações são anónimas." />
      ) : (
        <Card className="py-1">
          <ul className="divide-y divide-border">
            {items.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </ul>
        </Card>
      )}
      {nextCursor && (
        <Button variant="secondary" onClick={() => void loadMore()} loading={loading}>
          Carregar mais
        </Button>
      )}
    </Section>
  )
}
