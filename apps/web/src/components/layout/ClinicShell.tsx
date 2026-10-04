import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { cn } from '@/lib/cn'
import { paths } from '@/routes/paths'
import { clinicPortalService } from '@/services/clinicPortal.service'
import { LogoMark } from './Logo'
import { bandTitleClass } from './Page'

const tabs = [
  { to: paths.clinic, label: 'Pedidos', end: true },
  { to: paths.clinicAgenda, label: 'Agenda', end: false },
  { to: paths.clinicSlots, label: 'Horários', end: false },
]

/** Pedidos por responder (contador no separador); atualiza a cada navegação. */
function usePendingRequests(): number {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const userId = user?.id ?? ''
  const { state } = useAsync(() => clinicPortalService.listClinicBookings(userId), [userId, pathname])
  return state.status === 'success' ? state.data.filter((b) => b.status === 'REQUESTED').length : 0
}

/**
 * Portal da clínica parceira (D17): faixa com o nome da clínica e Sair, e separadores
 * Pedidos / Agenda / Horários. Mesmo layout no mobile e no desktop.
 */
export function ClinicShell() {
  const { clinic, logout } = useAuth()
  const navigate = useNavigate()
  const pending = usePendingRequests()

  function signOut() {
    logout()
    navigate(paths.login, { replace: true })
  }

  return (
    <div className="min-h-dvh">
      <header className="bg-brand pt-safe text-white">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4 lg:px-8">
          <LogoMark tone="inverse" className="size-8 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className={bandTitleClass}>{clinic?.name}</p>
          </div>
          <button
            type="button"
            onClick={signOut}
            aria-label="Sair"
            className="-mr-2 flex size-11 items-center justify-center rounded-full transition-colors hover:bg-white/15"
          >
            <LogOut className="size-5" aria-hidden />
          </button>
        </div>
      </header>
      <nav aria-label="Portal da clínica" className="mx-auto max-w-3xl px-4 pt-4 lg:px-8">
        <div className="flex gap-1 rounded-full bg-surface-muted p-1">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors',
                  isActive ? 'bg-surface text-foreground shadow-card' : 'text-muted hover:text-foreground',
                )
              }
            >
              {tab.label}
              {tab.to === paths.clinic && pending > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-xs leading-5 text-primary-foreground tabular-nums">
                  {pending}
                  <span className="sr-only"> por responder</span>
                </span>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
      <main
        id="conteudo"
        className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pt-5 pb-[max(2rem,env(safe-area-inset-bottom))] lg:px-8"
      >
        <Outlet />
      </main>
    </div>
  )
}
