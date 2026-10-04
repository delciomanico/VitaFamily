import { useAuth } from '@/contexts/AuthContext'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useAsync } from '@/hooks/useAsync'
import { firstName } from '@/lib/date'
import { reportService } from '@/services/report.service'
import { FamilyHealthCard } from './FamilyHealthCard'
import { ImportantAlerts } from './ImportantAlerts'
import { NextAppointment } from './NextAppointment'
import { QuickActions } from './QuickActions'
import { TodaySummary } from './TodaySummary'

/** Home: quem sou, o que tenho hoje, como está a família e o que precisa de atenção. */
export function HomePage() {
  const { user, family, member } = useAuth()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(() => reportService.getHomeSummary(familyId, userId), [familyId, userId])
  const name = firstName(member?.name ?? user?.name ?? '')

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Olá, {name} <span aria-hidden>👋</span>
        </h1>
        <p className="text-muted">Como está sua saúde hoje?</p>
      </div>

      {state.status === 'loading' && <LoadingState rows={4} label="A carregar o resumo…" />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && (
        <>
          <NextAppointment next={state.data.nextAppointment} />
          <ImportantAlerts alerts={state.data.unreadAlerts} />
          <div className="grid gap-6 md:grid-cols-2">
            <TodaySummary today={state.data.today} />
            <FamilyHealthCard family={state.data.family} />
          </div>
          <QuickActions />
        </>
      )}
    </>
  )
}
