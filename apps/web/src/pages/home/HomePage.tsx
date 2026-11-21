import { useContext } from 'react'
import { Page, bandTitleClass } from '@/components/layout/Page'
import { UnreadAlertsContext } from '@/components/layout/UnreadAlertsContext'
import { ErrorState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { firstName } from '@/lib/date'
import { reportService } from '@/services/report.service'
import { HomeBanner } from './HomeBanner'
import { HomeOptions } from './HomeOptions'

/**
 * Home num só ecrã, só com o foco principal: faixa, cartão grande (próximo compromisso)
 * e um botão «Mais opções» que abre uma folha com todas as outras ações.
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
    <Page title="Início" header={greeting} fullScreen>
      <HomeBanner next={state.status === 'success' ? state.data.nextAppointment : null} loading={state.status === 'loading'} />
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && <HomeOptions summary={state.data} unreadAlerts={unreadAlerts} />}
    </Page>
  )
}
