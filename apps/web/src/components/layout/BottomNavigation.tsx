import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { primaryNav } from './navigation'

/** Navegação inferior do mobile e tablet (< lg). */
export function BottomNavigation() {
  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-safe backdrop-blur lg:hidden"
    >
      <ul className="mx-auto flex h-(--spacing-bottom-nav) max-w-xl">
        {primaryNav.map((item) => {
          const Icon = item.icon
          return (
            <li key={item.to} className="flex-1">
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex h-full flex-col items-center justify-center gap-1 text-xs font-medium transition-colors',
                    isActive ? 'text-primary' : 'text-muted hover:text-foreground',
                  )
                }
              >
                <Icon className="size-6" aria-hidden />
                {item.label}
              </NavLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
