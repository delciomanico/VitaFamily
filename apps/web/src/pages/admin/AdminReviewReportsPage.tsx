import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Star } from 'lucide-react'
import { Stars } from '@/components/consultations/Stars'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Select, type SelectOption } from '@/components/ui/Select'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useCursorPages } from '@/hooks/useCursorPages'
import { queueStatusLabel, reviewReportReasonLabel } from '@/lib/consultations'
import { errorMessage } from '@/lib/errors'
import { formatWhenLuanda } from '@/lib/format'
import { paths } from '@/routes/paths'
import { adminConsultationService } from '@/services/adminConsultation.service'

type Status = 'OPEN' | 'DECIDED'
const STATUS_OPTIONS: SelectOption[] = [
  { value: 'OPEN', label: 'Por decidir' },
  { value: 'DECIDED', label: 'Decididas' },
]

/** Fila de denúncias de avaliações (`/admin/review-reports`, UC-MKT-43). A lista não mostra comentários. */
export function AdminReviewReportsPage() {
  const [status, setStatus] = useState<Status>('OPEN')
  const list = useCursorPages((cursor) => adminConsultationService.listReviewReports(status, cursor), [status])

  return (
    <>
      <h1 className="text-xl font-semibold">Denúncias de avaliações</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Select label="Estado" options={STATUS_OPTIONS} value={status} onChange={(event) => setStatus(event.target.value as Status)} />
      </div>

      {list.state.status === 'loading' && <LoadingState rows={3} />}
      {list.state.status === 'error' && <ErrorState message={errorMessage(list.state.error)} onRetry={list.reload} />}
      {list.state.status === 'success' &&
        (list.items.length > 0 ? (
          <section className="flex flex-col gap-3">
            <Card className="divide-y divide-border py-1">
              {list.items.map((item) => (
                <Link key={item.id} to={paths.adminReviewReport(item.id)} className="flex flex-col gap-1 rounded-md py-3 transition-colors hover:bg-surface-muted">
                  <span className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-medium">{reviewReportReasonLabel[item.reason]}</span>
                    <Badge tone={queueStatusLabel[item.status].tone} dot>
                      {queueStatusLabel[item.status].label}
                    </Badge>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
                    <Stars rating={item.rating} />
                    {item.professional.displayName}
                  </span>
                  <span className="text-xs text-muted">{formatWhenLuanda(item.createdAt)}</span>
                </Link>
              ))}
            </Card>
            {list.nextCursor && (
              <Button variant="secondary" onClick={() => void list.loadMore()} loading={list.loadingMore}>
                Carregar mais
              </Button>
            )}
          </section>
        ) : (
          <EmptyState icon={Star} title="Sem denúncias neste estado." />
        ))}
    </>
  )
}
