import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/cn'
import type { NavItem } from './navigation'

interface NavLinkItemProps {
  item: NavItem
  /** Contador à direita (ex.: alertas por ler). */
  count?: number
  countLabel?: string
  onNavigate?: () => void
}

/** Ligação de navegação partilhada pela sidebar e pelo menu. */
export function NavLinkItem({ item, count = 0, countLabel, onNavigate }: NavLinkItemProps) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      aria-label={count > 0 ? `${item.label}, ${count}${countLabel ? ` ${countLabel}` : ''}` : undefined}
      className={({ isActive }) =>
        cn(
          'flex h-12 items-center gap-3 rounded-full px-4 text-sm font-medium transition-colors',
          isActive ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-muted hover:text-foreground',
        )
      }
    >
      <Icon className="size-5" aria-hidden />
      <span className="flex-1">{item.label}</span>
      {count > 0 && (
        <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground" aria-hidden>
          {count}
        </span>
      )}
    </NavLink>
  )
}
