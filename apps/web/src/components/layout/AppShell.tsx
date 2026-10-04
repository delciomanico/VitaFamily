import { Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { alertService } from '@/services/alert.service'
import { BottomNavigation } from './BottomNavigation'
import { Header } from './Header'
import { Sidebar } from './Sidebar'

/** Alertas por ler para o sino do cabeçalho; atualiza a cada navegação. */
function useUnreadAlerts(): number {
  const { user, family } = useAuth()
  const { pathname } = useLocation()
  const familyId = family?.id
  const userId = user?.id
  const { state } = useAsync(
    () => (familyId && userId ? alertService.countUnread(familyId, userId) : Promise.resolve(0)),
    [familyId, userId, pathname],
  )
  return state.status === 'success' ? state.data : 0
}

/**
 * Estrutura da área autenticada.
 * Mobile/tablet: Header + conteúdo + BottomNavigation.
 * Desktop (≥ lg): Sidebar + conteúdo.
 */
export function AppShell() {
  const unreadAlerts = useUnreadAlerts()

  return (
    <div className="min-h-dvh">
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-md bg-surface px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Saltar para o conteúdo
      </a>
      <Sidebar />
      <div className="lg:pl-(--spacing-sidebar)">
        <Header unreadAlerts={unreadAlerts} />
        <main
          id="conteudo"
          className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-4 pb-[calc(var(--spacing-bottom-nav)+env(safe-area-inset-bottom)+1.5rem)] lg:px-8 lg:pb-12"
        >
          <Outlet />
        </main>
      </div>
      <BottomNavigation />
    </div>
  )
}
