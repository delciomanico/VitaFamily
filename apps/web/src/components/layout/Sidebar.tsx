import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { paths } from '@/routes/paths'
import { Logo } from './Logo'
import { primaryNav, settingsNav, type NavItem } from './navigation'

function SidebarLink({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
          isActive ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-muted hover:text-foreground',
        )
      }
    >
      <Icon className="size-5" aria-hidden />
      {item.label}
    </NavLink>
  )
}

/** Navegação lateral do desktop (≥ lg). */
export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-(--spacing-sidebar) flex-col border-r border-border bg-surface px-4 py-6 lg:flex">
      <NavLink to={paths.home} className="mb-8 px-2" aria-label="Vita Family, início">
        <Logo />
      </NavLink>
      <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-1">
        {primaryNav.map((item) => (
          <SidebarLink key={item.to} item={item} />
        ))}
      </nav>
      <SidebarLink item={settingsNav} />
    </aside>
  )
}
