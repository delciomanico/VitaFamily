import { Outlet } from 'react-router-dom'
import { BottomNavigation } from './BottomNavigation'
import { Header } from './Header'
import { Sidebar } from './Sidebar'

/**
 * Estrutura da área autenticada.
 * Mobile/tablet: Header + conteúdo + BottomNavigation.
 * Desktop (≥ lg): Sidebar + conteúdo.
 */
export function AppShell() {
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
        {/* TODO(fase 10): ligar ao número real de alertas por ler. */}
        <Header unreadAlerts={0} />
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
