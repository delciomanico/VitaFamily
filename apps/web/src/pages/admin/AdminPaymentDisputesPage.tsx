import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Banknote } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Select, type SelectOption } from '@/components/ui/Select'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useCursorPages } from '@/hooks/useCursorPages'
import { queueStatusLabel } from '@/lib/consultations'
import { errorMessage } from '@/lib/errors'
import { formatWhenLuanda } from '@/lib/format'
import { formatKz } from '@/lib/professional'
import { paths } from '@/routes/paths'
import { adminConsultationService } from '@/services/adminConsultation.service'

type Status = 'DISPUTED' | 'DECIDED'
const STATUS_OPTIONS: SelectOption[] = [
  { value: 'DISPUTED', label: 'Por decidir' },
  { value: 'DECIDED', label: 'Decididas' },
]

/** Fila de disputas de pagamento (`/admin/payment-disputes`, UC-MKT-38): mais antigas primeiro; a lista não mostra ficheiros nem textos. */
export function AdminPaymentDisputesPage() {
  const [status, setStatus] = useState<Status>('DISPUTED')
  const list = useCursorPages((cursor) => adminConsultationService.listDisputes(status, cursor), [status])

  return (
    <>
      <h1 className="text-xl font-semibold">Disputas de pagamento</h1>
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
                <Link key={item.proofId} to={paths.adminPaymentDispute(item.proofId)} className="flex flex-col gap-1 rounded-md py-3 transition-colors hover:bg-surface-muted">
                  <span className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-medium">{item.professional.displayName}</span>
                    <Badge tone={queueStatusLabel[item.status].tone} dot>
                      {queueStatusLabel[item.status].label}
                    </Badge>
                  </span>
                  <span className="text-sm text-muted">
                    {item.specialtyName} · consulta em {formatWhenLuanda(item.startsAt)} · {formatKz(item.priceKz)}
                  </span>
                  <span className="text-xs text-muted">Disputa aberta em {formatWhenLuanda(item.disputedAt)}</span>
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
          <EmptyState icon={Banknote} title="Sem disputas neste estado." />
        ))}
    </>
  )
}
