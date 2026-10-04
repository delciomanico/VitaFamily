import { useState } from 'react'
import { CalendarDays, CalendarPlus } from 'lucide-react'
import { AppointmentList } from '@/components/domain/AppointmentList'
import { DateStrip, nextDays } from '@/components/domain/DatePickers'
import { Page } from '@/components/layout/Page'
import { ButtonLink } from '@/components/ui/Button'
import { DetailSection } from '@/components/ui/InfoList'
import { Tabs, type TabItem } from '@/components/ui/Tabs'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { isUpcoming, localDay, needsOutcome } from '@/lib/appointment'
import { formatRelativeDay } from '@/lib/format'
import { paths } from '@/routes/paths'
import { appointmentService } from '@/services/appointment.service'
import type { AppointmentItem } from '@/types/appointment'

type Filter = 'UPCOMING' | 'HISTORY'

const filters: TabItem<Filter>[] = [
  { value: 'UPCOMING', label: 'Próximas' },
  { value: 'HISTORY', label: 'Histórico' },
]

/** Dias na tira do calendário. */
const STRIP_DAYS = 21

const bookIcon = <CalendarPlus className="size-4" aria-hidden />

interface UpcomingProps {
  items: AppointmentItem[]
  selfMemberId?: string
}

/** Próximas consultas: tira de dias (com ponto nos dias com consultas) e lista, filtrável por dia. */
function Upcoming({ items, selfMemberId }: UpcomingProps) {
  const [day, setDay] = useState<string | null>(null)
  const pending = items.filter(({ appointment }) => needsOutcome(appointment))
  const upcoming = items.filter(({ appointment }) => isUpcoming(appointment))
  const marked = new Set(upcoming.map(({ appointment }) => localDay(appointment.scheduledAt)))
  const shown = day ? upcoming.filter(({ appointment }) => localDay(appointment.scheduledAt) === day) : upcoming

  return (
    <div role="tabpanel" className="flex flex-col gap-5">
      {pending.length > 0 && (
        <DetailSection title="Por atualizar">
          <p className="-mt-1 text-sm text-muted">Já passaram: indique se foram realizadas.</p>
          <AppointmentList items={pending} selfMemberId={selfMemberId} />
        </DetailSection>
      )}

      <DateStrip
        days={nextDays(STRIP_DAYS)}
        value={day}
        onChange={setDay}
        marked={marked}
        label="Escolher dia"
        allowClear
      />

      <DetailSection title={day ? formatRelativeDay(day) : 'Próximas consultas'}>
        {shown.length > 0 ? (
          <AppointmentList items={shown} selfMemberId={selfMemberId} />
        ) : (
          <EmptyState
            icon={CalendarDays}
            title={day ? 'Sem consultas neste dia.' : 'Não existem consultas agendadas.'}
            action={
              <ButtonLink to={paths.appointmentNew} icon={bookIcon}>
                Marcar consulta
              </ButtonLink>
            }
          />
        )}
      </DetailSection>
    </div>
  )
}

export function AppointmentsPage() {
  const { user, family, member } = useAuth()
  const [filter, setFilter] = useState<Filter>('UPCOMING')
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(() => appointmentService.listAppointments(familyId, userId), [familyId, userId])

  const history =
    state.status === 'success'
      ? state.data.filter(({ appointment }) => !isUpcoming(appointment) && !needsOutcome(appointment)).reverse()
      : []

  return (
    <Page
      title="Agenda"
      action={
        <ButtonLink to={paths.appointmentNew} size="sm" icon={bookIcon}>
          Marcar consulta
        </ButtonLink>
      }
    >
      <Tabs label="Filtrar consultas" items={filters} value={filter} onChange={setFilter} />
      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' &&
        (filter === 'UPCOMING' ? (
          <Upcoming items={state.data} selfMemberId={member?.id} />
        ) : history.length > 0 ? (
          <div role="tabpanel">
            <AppointmentList items={history} selfMemberId={member?.id} />
          </div>
        ) : (
          <EmptyState icon={CalendarDays} title="Sem consultas anteriores." />
        ))}
    </Page>
  )
}
