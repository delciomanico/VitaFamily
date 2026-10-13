import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/cn'
import { paths } from '@/routes/paths'
import { bandTitleClass } from './Page'
import { LogoMark } from './Logo'

/**
 * Área do Platform Admin (`/admin/*`): faixa com a conta em sessão e Sair, e separadores
 * Contas / Clínicas. Mesma sessão de `User` da app de família (ver `admin.service.ts`), mas
 * nunca mostra nada de família — a conta de Platform Admin não tem uma.
 */
export function AdminShell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const tabs = [
    { to: paths.admin, label: 'Contas', end: true },
    { to: paths.adminClinics, label: 'Clínicas', end: false },
  ]

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
            <p className={bandTitleClass}>Administração</p>
            {user && <p className="truncate text-xs text-white/80">{user.email}</p>}
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
      <nav aria-label="Administração" className="mx-auto max-w-3xl px-4 pt-4 lg:px-8">
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
