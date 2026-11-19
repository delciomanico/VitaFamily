import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Flag } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Select, type SelectOption } from '@/components/ui/Select'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage } from '@/lib/errors'
import { formatWhenLuanda } from '@/lib/format'
import { reportStatusLabel, reportStatusTone, reportReasonLabel, sideLabel } from '@/lib/marketplace'
import { paths } from '@/routes/paths'
import { adminMessageReportService } from '@/services/adminMessageReport.service'
import type { AdminMessageReportItem } from '@/types/marketplace'

type ReportStatus = 'OPEN' | 'DECIDED'

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'OPEN', label: 'Por decidir' },
  { value: 'DECIDED', label: 'Decididas' },
]

/** Fila de denúncias de mensagens (`/admin/message-reports`, UC-MKT-24). Nunca mostra o texto das mensagens. */
export function AdminMessageReportsPage() {
  const toast = useToast()
  const [status, setStatus] = useState<ReportStatus>('OPEN')
  const { state, reload } = useAsync(() => adminMessageReportService.list(status), [status])

  // Páginas seguintes guardam a primeira página a que pertencem: ao mudar de estado, deixam de valer.
  const [extra, setExtra] = useState<{
    base: { items: AdminMessageReportItem[]; nextCursor: string | null }
    items: AdminMessageReportItem[]
    nextCursor: string | null
  } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const page = state.status === 'success' ? state.data : null
  const more = page && extra?.base === page ? extra : null
  const items = page ? [...page.items, ...(more?.items ?? [])] : []
  const nextCursor = more ? more.nextCursor : (page?.nextCursor ?? null)

  async function loadMore() {
    if (!page || !nextCursor) return
    setLoadingMore(true)
    try {
      const next = await adminMessageReportService.list(status, nextCursor)
      setExtra({ base: page, items: [...(more?.items ?? []), ...next.items], nextCursor: next.nextCursor })
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Denúncias de mensagens</h1>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Select
          label="Estado"
          options={STATUS_OPTIONS}
          value={status}
          onChange={(event) => setStatus(event.target.value as ReportStatus)}
        />
      </div>

      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState message={errorMessage(state.error)} onRetry={reload} />}

      {page &&
        (items.length > 0 ? (
          <section className="flex flex-col gap-3">
            <Card className="divide-y divide-border py-1">
              {items.map((item) => (
                <Link
                  key={item.id}
                  to={paths.adminMessageReport(item.id)}
                  className="flex flex-col gap-1 rounded-md py-3 transition-colors hover:bg-surface-muted"
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-medium">{reportReasonLabel[item.reason]}</span>
                    <Badge tone={reportStatusTone[item.status]} dot>
                      {reportStatusLabel[item.status]}
                    </Badge>
                  </span>
                  <span className="text-sm text-muted">
                    Lado denunciado: {sideLabel[item.reportedSide]} · {item.professionalDisplayName || 'Sem nome'}
                  </span>
                  <span className="text-xs text-muted">{formatWhenLuanda(item.createdAt)}</span>
                </Link>
              ))}
            </Card>
            {nextCursor && (
              <Button variant="secondary" onClick={() => void loadMore()} loading={loadingMore}>
                Carregar mais
              </Button>
            )}
          </section>
        ) : (
          <EmptyState icon={Flag} title="Sem denúncias neste estado." />
        ))}
    </>
  )
}
