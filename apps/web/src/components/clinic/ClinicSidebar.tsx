import { NavLink } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { LogoMark } from '@/components/layout/Logo'
import { cn } from '@/lib/cn'
import { clinicRole } from '@/lib/labels'
import type { ClinicSession } from '@/types/clinic'
import { clinicNav } from './clinicNav'

interface ClinicSidebarProps {
  session: ClinicSession | null
  isAdmin: boolean
  pending: number
  onSignOut: () => void
}

/** Barra lateral fixa do portal da clínica (desktop, `lg`): navegação, conta em sessão e Sair. */
export function ClinicSidebar({ session, isAdmin, pending, onSignOut }: ClinicSidebarProps) {
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-border bg-surface lg:flex">
      <div className="flex items-center gap-3 px-5 py-5">
        <LogoMark className="size-9 shrink-0" />
        <div className="min-w-0">
          <p className="truncate font-semibold">{session?.clinicName ?? 'Portal da clínica'}</p>
          <p className="truncate text-xs text-muted">{session ? clinicRole[session.role] : ''}</p>
        </div>
      </div>
      <nav aria-label="Portal da clínica" className="flex flex-1 flex-col gap-1 px-3 py-2">
        {clinicNav
          .filter((item) => isAdmin || !item.adminOnly)
          .map(({ to, label, icon: Icon, end, pending: showPending }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
                  isActive ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-muted hover:text-foreground',
                )
              }
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              <span className="flex-1">{label}</span>
              {showPending && pending > 0 && (
                <span className="rounded-full bg-primary px-2 text-xs leading-5 text-primary-foreground tabular-nums">
                  {pending}
                  <span className="sr-only"> por responder</span>
                </span>
              )}
            </NavLink>
          ))}
      </nav>
      <div className="border-t border-border p-3">
        {session?.email && <p className="truncate px-3 pb-2 text-xs text-muted">{session.email}</p>}
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
