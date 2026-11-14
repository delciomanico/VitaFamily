import { NavLink } from 'react-router-dom'
import { LogOut, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { LogoMark } from './Logo'

export interface PortalNavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Correspondência exata (a raiz não pode ficar ativa nas filhas). */
  end: boolean
  /** Contador (ex.: pedidos por responder); só aparece se > 0. */
  badge?: number
  /** Texto para leitores de ecrã do contador (ex.: «por responder»). */
  badgeLabel?: string
}

export interface PortalNavGroup {
  /** Título da secção; ausente = item solto no topo. */
  title?: string
  items: PortalNavItem[]
}

interface PortalNavListProps {
  ariaLabel: string
  groups: PortalNavGroup[]
  /** Chamado ao navegar (o menu móvel fecha-se). */
  onNavigate?: () => void
  className?: string
}

/** Navegação agrupada, partilhada pela barra lateral (desktop) e pelo menu móvel dos portais. */
export function PortalNavList({ ariaLabel, groups, onNavigate, className }: PortalNavListProps) {
  return (
    <nav aria-label={ariaLabel} className={cn('flex flex-col gap-4', className)}>
      {groups.map((group, index) => {
        if (group.items.length === 0) return null
        return (
          <div key={group.title ?? index} className="flex flex-col gap-1">
            {group.title && (
              <p className="px-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">{group.title}</p>
            )}
            {group.items.map(({ to, label, icon: Icon, end, badge, badgeLabel }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
                    isActive ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-muted hover:text-foreground',
                  )
                }
              >
                <Icon className="size-5 shrink-0" aria-hidden />
                <span className="flex-1">{label}</span>
                {badge !== undefined && badge > 0 && (
                  <span className="rounded-full bg-primary px-2 text-xs leading-5 text-primary-foreground tabular-nums">
                    {badge}
                    {badgeLabel && <span className="sr-only"> {badgeLabel}</span>}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        )
      })}
    </nav>
  )
}

interface PortalSidebarProps {
  ariaLabel: string
  title: string
  subtitle?: string
  email?: string | null
  groups: PortalNavGroup[]
  onSignOut: () => void
}

/**
 * Barra lateral fixa (desktop, `lg`) dos portais da clínica, da seguradora e da administração:
 * identidade, navegação por secções, conta em sessão e Sair.
 */
export function PortalSidebar({ ariaLabel, title, subtitle, email, groups, onSignOut }: PortalSidebarProps) {
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-border bg-surface lg:flex">
      <div className="flex items-center gap-3 px-5 py-5">
        <LogoMark className="size-9 shrink-0" />
        <div className="min-w-0">
          <p className="truncate font-semibold">{title}</p>
          {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
        </div>
      </div>
      <PortalNavList ariaLabel={ariaLabel} groups={groups} className="flex-1 overflow-y-auto px-3 py-2" />
      <div className="border-t border-border p-3">
        {email && <p className="truncate px-3 pb-2 text-xs text-muted">{email}</p>}
        <button
          type="button"
          onClick={onSignOut}
          className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted transition-colors hover:bg-surface-muted hover:text-foreground"
        >
          <LogOut className="size-5" aria-hidden />
          Sair
        </button>
      </div>
    </aside>
  )
}

/** Classes da área de trabalho ao lado da barra lateral, comuns aos três portais. */
export const portalMainClass =
  'mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pt-5 pb-[max(2rem,env(safe-area-inset-bottom))] lg:mx-0 lg:max-w-[calc(16rem+84rem)] lg:gap-6 lg:py-8 lg:pr-10 lg:pl-[calc(16rem+2.5rem)]'
