import { useContext } from 'react'
import { NavLink } from 'react-router-dom'
import { paths } from '@/routes/paths'
import { Logo } from './Logo'
import { NavLinkItem } from './NavLinkItem'
import { UnreadAlertsContext } from './UnreadAlertsContext'
import { alertsNav, primaryNav, settingsNav } from './navigation'

/** Navegação lateral do desktop (≥ lg). */
export function Sidebar() {
  const unread = useContext(UnreadAlertsContext)
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-(--spacing-sidebar) flex-col border-r border-border bg-surface px-4 py-6 lg:flex">
      <NavLink to={paths.home} className="mb-8 px-2" aria-label="Vita Family, início">
        <Logo />
      </NavLink>
      <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-1">
        {primaryNav.map((item) => (
          <NavLinkItem key={item.to} item={item} />
        ))}
        <NavLinkItem item={alertsNav} count={unread} countLabel="por ler" />
      </nav>
      <NavLinkItem item={settingsNav} />
    </aside>
  )
}
