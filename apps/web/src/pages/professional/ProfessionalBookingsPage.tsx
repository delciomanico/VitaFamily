import { useState } from 'react'
import { CalendarCheck } from 'lucide-react'
import { StatusBadges } from '@/components/consultations/StatusBadges'
import { LockedNotice } from '@/components/professional/LockedNotice'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { RowLink } from '@/components/ui/RowLink'
import { Select, type SelectOption } from '@/components/ui/Select'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useCursorPages } from '@/hooks/useCursorPages'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { professionalBookingStatusText } from '@/lib/consultations'
import { errorMessage } from '@/lib/errors'
import { formatWhenLuanda } from '@/lib/format'
import { formatKz, offerMethodLabel } from '@/lib/professional'
import { paths } from '@/routes/paths'
import { professionalBookingService } from '@/services/professionalBooking.service'
import type { BookingStatus } from '@/types/consultations'

/** Omissão do servidor: `REQUESTED` e `CONFIRMED` futuras. */
type Filter = 'NEXT' | BookingStatus

const OPTIONS: SelectOption[] = [
  { value: 'NEXT', label: 'Próximas (por responder e confirmadas)' },
  ...(['REQUESTED', 'CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED', 'REJECTED'] as BookingStatus[]).map((status) => ({ value: status, label: professionalBookingStatusText[status].label })),
]

/** Marcações do profissional (UC-MKT-30): só o rótulo do participante; nunca família, membro nem utilizador. */
export function ProfessionalBookingsPage() {
  usePageTitle('Marcações')
  const profile = useProfessionalProfile()
  const [filter, setFilter] = useState<Filter>('NEXT')
  const list = useCursorPages((cursor) => professionalBookingService.list({ status: filter === 'NEXT' ? undefined : filter, cursor }), [filter])
  const status = profile.profile?.validationStatus
  const notApproved = status === 'SUSPENDED' || status === 'REJECTED'

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Marcações</h1>
      {notApproved && <LockedNotice>A sua conta não está aprovada: as marcações estão só de leitura.</LockedNotice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Mostrar" options={OPTIONS} value={filter} onChange={(event) => setFilter(event.target.value as Filter)} />
      </div>

      {list.state.status === 'loading' && <LoadingState rows={3} />}
      {list.state.status === 'error' && <ErrorState message={errorMessage(list.state.error)} onRetry={list.reload} />}
      {list.state.status === 'success' &&
        (list.items.length === 0 ? (
          <EmptyState icon={CalendarCheck} title="Sem marcações nesta lista." description="Quando uma família marcar um dos seus horários, o pedido aparece aqui." />
        ) : (
          <>
            <Card>
              <ul className="flex flex-col divide-y divide-border">
                {list.items.map((b) => (
                  <li key={b.id}>
                    <RowLink to={paths.professionalBooking(b.id)}>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <p className="truncate font-medium">{b.participantLabel}</p>
                        <p className="text-sm text-muted">
                          {b.offer.specialtyName} · {offerMethodLabel[b.offer.method]} · {formatKz(b.priceKz)}
                        </p>
                        <time className="text-sm" dateTime={b.startsAt}>
                          {formatWhenLuanda(b.startsAt)}
                        </time>
                        <StatusBadges status={b.status} paymentStatus={b.paymentStatus} priceKz={b.priceKz} side="PROFESSIONAL" />
                        {b.proof?.status === 'SUBMITTED' && <p className="text-sm font-medium text-primary">Comprovativo por analisar.</p>}
                      </div>
                    </RowLink>
                  </li>
                ))}
              </ul>
            </Card>
            {list.nextCursor && (
              <Button variant="secondary" onClick={() => void list.loadMore()} loading={list.loadingMore}>
                Carregar mais
              </Button>
            )}
          </>
        ))}
    </div>
  )
}
