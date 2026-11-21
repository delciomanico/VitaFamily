import { useContext } from 'react'
import { Sunrise } from '@/components/app/Sunrise'
import { Page } from '@/components/layout/Page'
import { UnreadAlertsContext } from '@/components/layout/UnreadAlertsContext'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { firstName } from '@/lib/date'
import { formatLongDate, luandaDayISO } from '@/lib/format'
import { reportService } from '@/services/report.service'
import { HOME_BANNER_SRC } from './homeBanner'
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

  const doses = state.status === 'success' ? state.data.todayDoses : []
  const taken = doses.filter((d) => d.status === 'TAKEN').length

  const hero = (
    <>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[1.5rem] leading-tight font-semibold text-balance">Olá, {firstName(name)}</h1>
          <p className="mt-1 text-base text-white/90">{formatLongDate(luandaDayISO(new Date()))}</p>
          {doses.length > 0 && (
            <p className="mt-0.5 text-base font-semibold text-sun">
              {taken} de {doses.length} {doses.length === 1 ? 'toma feita' : 'tomas feitas'}
            </p>
          )}
        </div>
        <div className="w-36 shrink-0">
          <Sunrise done={taken} total={doses.length} />
        </div>
      </div>
      {state.status === 'success' && <HomePrimaryCard next={state.data.nextAppointment} />}
    </>
  )

  return (
    <Page title="Início" hero={hero} heroImage={HOME_BANNER_SRC}>
      {state.status === 'loading' && <LoadingState rows={3} label="A preparar o seu dia…" />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && (
        <>
          <TodayDoses doses={state.data.todayDoses} />
          <HomeOptions summary={state.data} unreadAlerts={unreadAlerts} />
          <RecentAlerts alerts={state.data.recentAlerts} />
        </>
      )}
    </Page>
  )
}
