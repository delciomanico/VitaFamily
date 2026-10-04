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
 * Home num só ecrã, sem scroll vertical: faixa, banner (com o próximo compromisso)
 * e menu de opções deslizante, com o resumo de hoje nas legendas.
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
    <Page title="Início" header={greeting} menu="avatar" fullScreen>
      <HomeBanner next={state.status === 'success' ? state.data.nextAppointment : null} />
      {state.status === 'loading' && (
        <div role="status" className="grid h-48 shrink-0 grid-cols-4 gap-3" aria-label="A carregar…">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="mx-auto size-14 animate-pulse rounded-2xl bg-surface-muted" aria-hidden />
          ))}
        </div>
      )}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && <HomeOptions summary={state.data} unreadAlerts={unreadAlerts} />}
    </Page>
  )
}
