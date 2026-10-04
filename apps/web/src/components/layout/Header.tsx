import { Link, NavLink } from 'react-router-dom'
import { Bell, Settings } from 'lucide-react'
import { cn } from '@/lib/cn'
import { paths } from '@/routes/paths'
import { Logo } from './Logo'

const iconButton =
  'relative flex size-11 items-center justify-center rounded-full text-foreground transition-colors hover:bg-surface-muted'

interface HeaderProps {
  /** Número de alertas por ler (mostra um ponto no sino). */
  unreadAlerts?: number
}

/**
 * Barra superior. No mobile mostra o logo e o acesso a Alertas e Configurações;
 * no desktop o logo e as Configurações já estão na sidebar.
 */
export function Header({ unreadAlerts = 0 }: HeaderProps) {
  const alertsLabel = unreadAlerts > 0 ? `Alertas, ${unreadAlerts} por ler` : 'Alertas'

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 pt-safe backdrop-blur lg:border-none">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 lg:h-16 lg:justify-end lg:px-8">
        <Link to={paths.home} className="lg:hidden" aria-label="Vita Family, início">
          <Logo />
        </Link>
        <div className="flex items-center gap-1">
          <NavLink
            to={paths.alerts}
            aria-label={alertsLabel}
            className={({ isActive }) => cn(iconButton, isActive && 'bg-primary-soft text-primary')}
          >
            <Bell className="size-5" aria-hidden />
            {unreadAlerts > 0 && (
              <span className="absolute top-2.5 right-2.5 size-2 rounded-full bg-danger ring-2 ring-background" />
            )}
          </NavLink>
          <NavLink
            to={paths.settings}
            aria-label="Configurações"
            className={({ isActive }) => cn(iconButton, 'lg:hidden', isActive && 'bg-primary-soft text-primary')}
          >
            <Settings className="size-5" aria-hidden />
          </NavLink>
        </div>
      </div>
    </header>
  )
}
