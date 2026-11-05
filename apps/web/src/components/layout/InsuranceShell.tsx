import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { InsuranceAuthProvider, useInsuranceAuth } from '@/contexts/InsuranceAuthContext'
import { cn } from '@/lib/cn'
import { paths } from '@/routes/paths'
import { insuranceRole } from '@/types/insurance'
import { LogoMark } from './Logo'
import { bandTitleClass } from './Page'

/**
 * Raiz de `/insurance/*` (ADR-021): monta a sessão de `InsuranceAccount` só nesta árvore de rotas,
 * sem ligação ao `AuthProvider` da app nem ao `ClinicAuthProvider`.
 */
export function InsurancePortalRoot() {
  return (
    <InsuranceAuthProvider>
      <Outlet />
    </InsuranceAuthProvider>
  )
}

/** Portal da seguradora: faixa com a conta em sessão e Sair; separadores Pedidos (+ Agentes, só Admin). */
export function InsuranceShell() {
  const { session, isAdmin, logout } = useInsuranceAuth()
  const navigate = useNavigate()

  const tabs = [
    { to: paths.insurance, label: 'Pedidos', end: true },
    ...(isAdmin ? [{ to: paths.insuranceAgents, label: 'Agentes', end: false }] : []),
  ]

  async function signOut() {
    await logout()
    navigate(paths.insuranceLogin, { replace: true })
  }

  return (
    <div className="min-h-dvh">
      <header className="bg-brand pt-safe text-white">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4 lg:px-8">
          <LogoMark tone="inverse" className="size-8 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className={bandTitleClass}>{session?.email ?? 'Portal da seguradora'}</p>
            {session && <p className="truncate text-xs text-white/80">{insuranceRole[session.role]}</p>}
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            aria-label="Sair"
            className="-mr-2 flex size-11 items-center justify-center rounded-full transition-colors hover:bg-white/15"
          >
            <LogOut className="size-5" aria-hidden />
          </button>
        </div>
      </header>
      <nav aria-label="Portal da seguradora" className="mx-auto max-w-3xl px-4 pt-4 lg:px-8">
        <div className="flex gap-1 rounded-full bg-surface-muted p-1">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  'flex h-9 flex-1 items-center justify-center rounded-full px-3 text-sm font-medium transition-colors',
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
