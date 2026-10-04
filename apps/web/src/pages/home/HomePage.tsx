import { useContext } from 'react'
import { CalendarPlus } from 'lucide-react'
import { AppointmentCard } from '@/components/domain/AppointmentCard'
import { Page } from '@/components/layout/Page'
import { UnreadAlertsContext } from '@/components/layout/UnreadAlertsContext'
import { ButtonLink } from '@/components/ui/Button'
import { Section } from '@/components/ui/Card'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { firstName } from '@/lib/date'
import { paths } from '@/routes/paths'
import { reportService } from '@/services/report.service'
import { FamilyHealthCard } from './FamilyHealthCard'
import { HomeBanner } from './HomeBanner'
import { HomeGrid } from './HomeGrid'
import { ImportantAlerts } from './ImportantAlerts'

/** Saudação da faixa (como “Name” na referência); o avatar ao lado abre o menu. */
function Greeting({ name }: { name: string }) {
  return (
    <h1 className="truncate text-[1.75rem] leading-tight font-semibold tracking-tight">
      Olá, {firstName(name)} <span aria-hidden>👋</span>
    </h1>
  )
}

/** Home: quem sou, o que tenho hoje, como está a família e o que precisa de atenção. */
export function HomePage() {
  const { user, family, member } = useAuth()
  const unreadAlerts = useContext(UnreadAlertsContext)
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(() => reportService.getHomeSummary(familyId, userId), [familyId, userId])
  const name = member?.name ?? user?.name ?? ''

  return (
    <Page title="Início" header={<Greeting name={name} />} menu="avatar" description="Como está sua saúde hoje?">
      <HomeBanner />

      {state.status === 'loading' && <LoadingState rows={3} label="A carregar o resumo…" />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && (
        <>
          <Section title="Próximo compromisso">
            {state.data.nextAppointment ? (
              <AppointmentCard
                appointment={state.data.nextAppointment.appointment}
                memberName={state.data.nextAppointment.isSelf ? undefined : state.data.nextAppointment.memberName}
                to={paths.appointment(state.data.nextAppointment.appointment.id)}
              />
            ) : (
              <EmptyState icon={CalendarPlus} title="Não existem consultas agendadas." />
            )}
          </Section>
          <HomeGrid summary={state.data} unreadAlerts={unreadAlerts} />
          <ImportantAlerts alerts={state.data.unreadAlerts} />
          <FamilyHealthCard family={state.data.family} />
          <ButtonLink
            to={paths.appointmentNew}
            size="lg"
            className="mx-auto w-full max-w-xs"
            icon={<CalendarPlus className="size-5" aria-hidden />}
          >
            Marcar consulta
          </ButtonLink>
        </>
      )}
    </Page>
  )
}
