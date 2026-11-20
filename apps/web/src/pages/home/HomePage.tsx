import { useContext } from 'react'
import { Page, bandTitleClass } from '@/components/layout/Page'
import { UnreadAlertsContext } from '@/components/layout/UnreadAlertsContext'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { firstName } from '@/lib/date'
import { reportService } from '@/services/report.service'
import { HomePrimaryCard } from './HomePrimaryCard'
import { HomeOptions } from './HomeOptions'
import { RecentAlerts } from './RecentAlerts'
import { TodayDoses } from './TodayDoses'

/**
 * Início: saudação, uma só ação principal (próximo compromisso ou encontrar um profissional),
 * 4 atalhos (o resto na folha «Mais opções»), tomas de hoje e os últimos alertas.
 */
export function HomePage() {
  const { user, family, member } = useAuth()
  const unreadAlerts = useContext(UnreadAlertsContext)
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(() => reportService.getHomeSummary(familyId, userId), [familyId, userId])
  const name = member?.name ?? user?.name ?? ''

  const greeting = (
    <h1 className={bandTitleClass}>
      Olá, {firstName(name)}
    </h1>
  )

  return (
    <Page title="Início" header={greeting}>
      {state.status === 'loading' && <LoadingState rows={3} label="A preparar o seu dia…" />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && (
        <>
          <HomePrimaryCard next={state.data.nextAppointment} />
          <TodayDoses doses={state.data.todayDoses} />
          <HomeOptions summary={state.data} unreadAlerts={unreadAlerts} />
          <RecentAlerts alerts={state.data.recentAlerts} />
        </>
      )}
    </Page>
  )
}
