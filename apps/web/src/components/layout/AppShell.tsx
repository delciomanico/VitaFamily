import { Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { alertService } from '@/services/alert.service'
import { RefreshUnreadAlertsContext, UnreadAlertsContext } from './UnreadAlertsContext'
import { AppBackdrop } from './AppBackdrop'
import { BottomNav } from './BottomNav'
import { Sidebar } from './Sidebar'
import { useBrandBackground } from './useBrandBackground'

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
 * Mobile/tablet: barra inferior (BottomNav) e, em cada página, faixa com voltar, título e alertas.
 * Desktop (≥ lg): Sidebar + conteúdo.
 */
export function AppShell() {
  const unread = useUnreadAlerts()
  const { pathname } = useLocation()
  useBrandBackground()

  return (
    <UnreadAlertsContext.Provider value={unread.count}>
      <RefreshUnreadAlertsContext.Provider value={unread.reload}>
        <div className="app-mobile min-h-dvh pb-(--bottom-nav-h) [--bottom-nav-h:calc(5rem+var(--safe-bottom))] lg:[--bottom-nav-h:0px]">
          <a
            href="#conteudo"
            className="sr-only z-50 rounded-md bg-surface px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
          >
            Saltar para o conteúdo
          </a>
          <AppBackdrop />
          <Sidebar />
          <main id="conteudo" className="relative z-10 lg:pl-(--spacing-sidebar)">
            <div key={pathname} className="animate-page-in">
              <Outlet />
            </div>
          </main>
          <BottomNav />
        </div>
      </RefreshUnreadAlertsContext.Provider>
    </UnreadAlertsContext.Provider>
  )
}
