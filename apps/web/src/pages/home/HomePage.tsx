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
import { RecentAlerts } from './RecentAlerts'
import { TodayDoses } from './TodayDoses'

/**
 * Home num só ecrã, sem scroll vertical: faixa, banner (com o próximo compromisso),
 * menu de opções deslizante (resumo de hoje nas legendas) e, no espaço que sobra,
 * as tomas de hoje e os alertas recentes (só o que couber).
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
      Olá, {firstName(name)} <span aria-hidden>👋</span>
    </h1>
  )

  return (
    <Page title="Início" header={greeting} fullScreen>
      <HomeBanner next={state.status === 'success' ? state.data.nextAppointment : null} />
      {state.status === 'loading' && (
        <div role="status" className="grid shrink-0 grid-cols-4 gap-x-1 gap-y-9" aria-label="A carregar…">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="mx-auto size-12 animate-pulse rounded-xl bg-surface-muted" aria-hidden />
          ))}
        </div>
      )}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && (
        <>
          <HomeOptions summary={state.data} unreadAlerts={unreadAlerts} />
          {/*
            Espaço livre restante: tomas de hoje (altura natural) e alertas recentes (o resto).
            Cada cartão só aparece se couber, para a Home nunca ter scroll.
          */}
          <div className="fit-area flex min-h-0 flex-1 flex-col gap-3">
            <TodayDoses doses={state.data.todayDoses} />
            <div className="fit-area min-h-0 flex-1">
              <RecentAlerts alerts={state.data.recentAlerts} />
            </div>
          </div>
        </>
      )}
    </Page>
  )
}
