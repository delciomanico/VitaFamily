import { useContext } from 'react'
import { Link } from 'react-router-dom'
import { CalendarPlus } from 'lucide-react'
import { AppointmentCard } from '@/components/domain/AppointmentCard'
import { Page, UnreadAlertsContext } from '@/components/layout/Page'
import { Avatar } from '@/components/ui/Avatar'
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

function Greeting({ name }: { name: string }) {
  return (
    <div className="flex items-center justify-between gap-4 pt-1">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Olá, {firstName(name)} <span aria-hidden>👋</span>
        </h1>
        <p>Como está sua saúde hoje?</p>
      </div>
      <Link to={paths.healthProfile} aria-label="O meu perfil de saúde" className="shrink-0 rounded-full ring-2 ring-white/60">
        <Avatar name={name} size="lg" className="bg-white" />
      </Link>
    </div>
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
    <Page title="Início" header={<Greeting name={name} />}>
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
