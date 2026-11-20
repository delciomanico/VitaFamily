import { useContext } from 'react'
import { NavLink } from 'react-router-dom'
import { Avatar } from '@/components/ui/Avatar'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/cn'
import { UnreadAlertsContext } from './UnreadAlertsContext'
import { bottomNav, profileNav } from './navigation'

const itemClass = (isActive: boolean) =>
  cn(
    'flex min-h-16 flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[0.8125rem] leading-tight font-semibold transition-colors',
    isActive ? 'text-primary' : 'text-muted hover:text-foreground',
  )

/**
 * Barra inferior da app da família (telemóvel e tablet, < lg): poucas áreas por ordem de importância
 * e, no fim, o perfil (avatar). O resto das áreas está no Início e no Perfil.
 */
export function BottomNav() {
  const { user, member } = useAuth()
  const unread = useContext(UnreadAlertsContext)
  const name = member?.name ?? user?.name ?? ''

  return (
    <nav
      aria-label="Barra inferior"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] shadow-overlay lg:hidden"
    >
      <ul className="mx-auto flex max-w-3xl items-stretch gap-1 px-2 pt-1">
        {bottomNav.map(({ to, label, icon: Icon, end }) => (
          <li key={to} className="flex flex-1">
            <NavLink to={to} end={end} className={({ isActive }) => itemClass(isActive)}>
              {({ isActive }) => (
                <>
                  <span className={cn('flex h-8 w-14 items-center justify-center rounded-full', isActive && 'bg-primary-soft')}>
                    <Icon className="size-6" strokeWidth={isActive ? 2.2 : 1.8} aria-hidden />
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
                  <Avatar name={name} size="sm" className={cn(isActive && 'ring-2 ring-primary')} />
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
