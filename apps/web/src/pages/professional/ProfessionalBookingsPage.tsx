import { useState } from 'react'
import { CalendarCheck } from 'lucide-react'
import { BookingCard } from '@/components/app/BookingCard'
import { FilterChips, type ChipItem } from '@/components/app/FilterChips'
import { TabHeader } from '@/components/app/ScreenHeader'
import { LockedNotice } from '@/components/professional/LockedNotice'
import { Button, ButtonLink } from '@/components/ui/Button'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useCursorPages } from '@/hooks/useCursorPages'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { errorMessage } from '@/lib/errors'
import { formatLongDate, luandaDayISO } from '@/lib/format'
import { paths } from '@/routes/paths'
import { professionalBookingService } from '@/services/professionalBooking.service'
import type { BookingStatus, ProfessionalBooking } from '@/types/consultations'

/** Omissão do servidor: `REQUESTED` e `CONFIRMED` futuras. */
type Filter = 'NEXT' | BookingStatus

const CHIPS: ChipItem<Filter>[] = [
  { value: 'NEXT', label: 'Próximas' },
  { value: 'REQUESTED', label: 'Por responder' },
  { value: 'CONFIRMED', label: 'Confirmadas' },
  { value: 'COMPLETED', label: 'Concluídas' },
  { value: 'NO_SHOW', label: 'Faltas' },
  { value: 'CANCELLED', label: 'Canceladas' },
  { value: 'REJECTED', label: 'Recusadas' },
]

const EMPTY_TEXT: Record<Filter, string> = {
  NEXT: 'Quando uma família marcar um dos seus horários, o pedido aparece aqui.',
  REQUESTED: 'Não há pedidos à espera da sua resposta.',
  CONFIRMED: 'Ainda não confirmou nenhuma marcação.',
  COMPLETED: 'As consultas que concluir ficam guardadas aqui.',
  NO_SHOW: 'Nenhuma falta registada.',
  CANCELLED: 'Nenhuma marcação cancelada.',
  REJECTED: 'Não recusou nenhum pedido.',
}

/** Agrupa por dia de Luanda, mantendo a ordem em que a lista chega. */
function groupByDay(items: ProfessionalBooking[]): Array<[string, ProfessionalBooking[]]> {
  const groups = new Map<string, ProfessionalBooking[]>()
  for (const item of items) {
    const day = luandaDayISO(item.startsAt)
    groups.set(day, [...(groups.get(day) ?? []), item])
  }
  return [...groups.entries()]
}

/** Marcações do profissional (UC-MKT-30): só o rótulo do participante; nunca família, membro nem utilizador. */
export function ProfessionalBookingsPage() {
  usePageTitle('Marcações')
  const profile = useProfessionalProfile()
  const [filter, setFilter] = useState<Filter>('NEXT')
  const list = useCursorPages((cursor) => professionalBookingService.list({ status: filter === 'NEXT' ? undefined : filter, cursor }), [filter])
  const status = profile.profile?.validationStatus
  const notApproved = status === 'SUSPENDED' || status === 'REJECTED'
  const now = new Date()
  const today = luandaDayISO(now)
  const tomorrow = luandaDayISO(new Date(now.getTime() + 86_400_000))
  const heading = (day: string) => (day === today ? 'Hoje' : day === tomorrow ? 'Amanhã' : formatLongDate(day))

  return (
    <div className="flex flex-col gap-5">
      <TabHeader title="Marcações" />
      {notApproved && <LockedNotice>A sua conta não está aprovada: as marcações estão só de leitura.</LockedNotice>}
      <FilterChips items={CHIPS} value={filter} onChange={setFilter} label="Mostrar marcações" />

      {list.state.status === 'loading' && <LoadingState rows={3} />}
      {list.state.status === 'error' && <ErrorState message={errorMessage(list.state.error)} onRetry={list.reload} />}
      {list.state.status === 'success' &&
        (list.items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-strong px-6 py-10 text-center">
            <CalendarCheck className="size-10 text-muted" aria-hidden />
            <p className="text-lg font-semibold">Sem marcações nesta lista.</p>
            <p className="text-base text-muted">{EMPTY_TEXT[filter]}</p>
            {filter === 'NEXT' && (
              <ButtonLink to={paths.professionalSchedule} variant="soft" size="lg">
                Ver os meus horários
              </ButtonLink>
            )}
          </div>
        ) : (
          <>
            {groupByDay(list.items).map(([day, items]) => (
              <section key={day} aria-label={heading(day)} className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold first-letter:uppercase">{heading(day)}</h2>
                <ul className="flex flex-col gap-3">
                  {items.map((booking) => (
                    <li key={booking.id}>
                      <BookingCard booking={booking} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {list.nextCursor && (
              <Button variant="secondary" size="lg" fullWidth onClick={() => void list.loadMore()} loading={list.loadingMore}>
                Ver mais
              </Button>
            )}
          </>
        ))}
    </div>
  )
}
