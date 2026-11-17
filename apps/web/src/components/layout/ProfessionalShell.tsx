import { Outlet, useNavigate } from 'react-router-dom'
import { professionalNavItems } from '@/components/professional/professionalNav'
import { ProfessionalAuthProvider, useProfessionalAuth } from '@/contexts/ProfessionalAuthContext'
import { paths } from '@/routes/paths'
import { PortalMobileHeader } from './PortalMobileHeader'
import { PortalSidebar, portalMainClass, type PortalNavGroup } from './PortalSidebar'

/**
 * Raiz de `/profissional/*` (ADR-037): monta a sessão de `ProfessionalAccount` **só** nesta árvore de rotas,
 * sem ligação ao `AuthProvider` da família nem ao `ClinicAuthProvider`.
 */
export function ProfessionalPortalRoot() {
  return (
    <ProfessionalAuthProvider>
      <Outlet />
    </ProfessionalAuthProvider>
  )
}

/** Portal do profissional: barra lateral (desktop) e menu (telemóvel) com a mesma navegação dos outros portais. */
export function ProfessionalShell() {
  const { session, logout } = useProfessionalAuth()
  const navigate = useNavigate()
  const groups: PortalNavGroup[] = [{ items: professionalNavItems }]

  async function signOut() {
    await logout()
    navigate(paths.professionalLogin, { replace: true })
  }

  return (
    <div className="min-h-dvh">
      <PortalSidebar
        ariaLabel="Portal do profissional"
        title="Portal do profissional"
        subtitle="Vita Family"
        email={session?.email}
        groups={groups}
        onSignOut={() => void signOut()}
      />
      <PortalMobileHeader
        ariaLabel="Portal do profissional"
        title="Portal do profissional"
        subtitle="Vita Family"
        email={session?.email}
        groups={groups}
        onSignOut={() => void signOut()}
      />
      <main id="conteudo" className={portalMainClass}>
        <Outlet />
      </main>
    </div>
  )
}
