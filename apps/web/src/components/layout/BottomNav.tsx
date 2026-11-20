import { useContext } from 'react'
import { NavLink } from 'react-router-dom'
import { UserRound } from 'lucide-react'
import { cn } from '@/lib/cn'
import { UnreadAlertsContext } from './UnreadAlertsContext'
import { bottomNav, profileNav } from './navigation'

const itemClass = (isActive: boolean) =>
  cn(
    'flex min-h-16 flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[0.8125rem] leading-tight transition-colors',
    isActive ? 'font-semibold text-primary' : 'font-semibold text-muted hover:text-foreground',
  )

/**
 * Barra inferior da app da família (telemóvel e tablet, < lg): poucas áreas por ordem de importância
 * e, no fim, o perfil (ícone de pessoa). O resto das áreas está no Início e no Perfil.
 */
export function BottomNav() {
  const unread = useContext(UnreadAlertsContext)

  return (
    <nav
      aria-label="Barra inferior"
      className="fixed inset-x-0 bottom-0 z-30 rounded-t-3xl bg-surface pb-[env(safe-area-inset-bottom)] shadow-overlay lg:hidden"
    >
      <ul className="mx-auto flex max-w-3xl items-stretch gap-1 px-2 pt-1">
        {bottomNav.map(({ to, label, icon: Icon, end }) => (
          <li key={to} className="flex flex-1">
            <NavLink to={to} end={end} className={({ isActive }) => itemClass(isActive)}>
              {({ isActive }) => (
                <>
                  <span className="relative flex h-8 w-14 items-center justify-center">
                    <span aria-hidden className={cn('absolute inset-0 origin-center rounded-full bg-primary-soft transition-all duration-300 ease-out', isActive ? 'scale-100 opacity-100' : 'scale-x-50 scale-y-75 opacity-0')} />
                    <Icon className={cn('relative size-6 transition-transform duration-300', isActive && '-translate-y-px scale-110')} strokeWidth={isActive ? 2.3 : 1.8} aria-hidden />
                  </span>
                  {label}
                </>
              )}
            </NavLink>
          </li>
        ))}
        <li className="flex flex-1">
          <NavLink
            to={profileNav.to}
            aria-label={unread > 0 ? `${profileNav.label}, ${unread} alertas por ler` : profileNav.label}
            className={({ isActive }) => itemClass(isActive)}
          >
            {({ isActive }) => (
              <>
                <span className="relative flex h-8 w-14 items-center justify-center">
                    <span aria-hidden className={cn('absolute inset-0 origin-center rounded-full bg-primary-soft transition-all duration-300 ease-out', isActive ? 'scale-100 opacity-100' : 'scale-x-50 scale-y-75 opacity-0')} />
                  <UserRound className={cn('relative size-6 transition-transform duration-300', isActive && '-translate-y-px scale-110')} strokeWidth={isActive ? 2.3 : 1.8} aria-hidden />
                  {unread > 0 && <span className="absolute top-0 right-3 size-3 rounded-full bg-danger ring-2 ring-surface" />}
                </span>
                {profileNav.label}
              </>
            )}
          </NavLink>
        </li>
      </ul>
    </nav>
  )
}
