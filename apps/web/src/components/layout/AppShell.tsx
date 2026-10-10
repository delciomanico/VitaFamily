import { Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { alertService } from '@/services/alert.service'
import { RefreshUnreadAlertsContext, UnreadAlertsContext } from './UnreadAlertsContext'
import { Sidebar } from './Sidebar'

/** Alertas por ler para o menu e a sidebar; atualiza a cada navegação. */
function useUnreadAlerts() {
  const { user, family } = useAuth()
  const { pathname } = useLocation()
  const familyId = family?.id
  const userId = user?.id
  const { state, reload } = useAsync(
    () => (familyId && userId ? alertService.countUnread(familyId, userId) : Promise.resolve(0)),
    [familyId, userId, pathname],
  )
  return { count: state.status === 'success' ? state.data : 0, reload }
}

/**
 * Estrutura da área autenticada.
 * Mobile/tablet: cada página com a sua faixa (voltar, título, menu); a Home dá acesso às áreas.
 * Desktop (≥ lg): Sidebar + conteúdo.
 */
export function AppShell() {
  const unread = useUnreadAlerts()

  return (
    <UnreadAlertsContext.Provider value={unread.count}>
      <RefreshUnreadAlertsContext.Provider value={unread.reload}>
        <div className="min-h-dvh">
          <a
            href="#conteudo"
            className="sr-only z-50 rounded-md bg-surface px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
          >
            Saltar para o conteúdo
          </a>
          <Sidebar />
          <main id="conteudo" className="lg:pl-(--spacing-sidebar)">
            <Outlet />
          </main>
        </div>
      </RefreshUnreadAlertsContext.Provider>
    </UnreadAlertsContext.Provider>
  )
}
