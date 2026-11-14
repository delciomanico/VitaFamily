import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ClinicSearch } from '@/components/clinic/ClinicSearch'
import { clinicNavGroups, visibleNavItems } from '@/components/clinic/clinicNav'
import { ClinicAuthProvider, useClinicAuth } from '@/contexts/ClinicAuthContext'
import { useAsync } from '@/hooks/useAsync'
import { clinicRole } from '@/lib/labels'
import { paths } from '@/routes/paths'
import { clinicPortalService } from '@/services/clinicPortal.service'
import { PortalMobileHeader } from './PortalMobileHeader'
import { PortalSidebar, portalMainClass, type PortalNavGroup } from './PortalSidebar'

/**
 * Raiz de `/clinic/*` (ADR-020): monta a sessão de `ClinicAccount` **só** nesta árvore de rotas,
 * sem qualquer ligação ao `AuthProvider` da app de família (que envolve a app em `main.tsx`).
 */
export function ClinicPortalRoot() {
  return (
    <ClinicAuthProvider>
      <Outlet />
    </ClinicAuthProvider>
  )
}

/** Pedidos por responder (contador na navegação); atualiza a cada navegação. */
function usePendingRequests(enabled: boolean): number {
  const { pathname } = useLocation()
  // O Médico não vê pedidos (BR-CLN-39): nem sequer se pergunta ao servidor.
  const { state } = useAsync(() => (enabled ? clinicPortalService.listRequests() : Promise.resolve([])), [pathname, enabled])
  return state.status === 'success' ? state.data.length : 0
}

/**
 * Portal da clínica parceira (D17/D18). Desktop (`lg`): barra lateral fixa e área de trabalho larga;
 * telemóvel: faixa com a conta e menu com a mesma navegação (como os outros portais).
 */
export function ClinicShell() {
  const { session, isAdmin, isDoctor, logout } = useClinicAuth()
  const navigate = useNavigate()
  const pending = usePendingRequests(!isDoctor)

  // O contrato do portal não expõe o nome da clínica (ClinicTokenResponse só tem `clinicId`/`role`):
  // identifica-se a conta em sessão e o seu papel.
  const title = session?.clinicName ?? session?.email ?? 'Portal da clínica'
  const subtitle = session ? clinicRole[session.role] : undefined
  const groups: PortalNavGroup[] = clinicNavGroups.map((group) => ({
    title: group.title,
    items: visibleNavItems(group.items, { isAdmin, isDoctor }).map(({ pending: showPending, ...item }) => ({
      ...item,
      badge: showPending ? pending : undefined,
      badgeLabel: showPending ? 'por responder' : undefined,
    })),
  }))

  async function signOut() {
    await logout()
    navigate(paths.clinicLogin, { replace: true })
  }

  return (
    <div className="min-h-dvh">
      <PortalSidebar
        ariaLabel="Portal da clínica"
        title={title}
        subtitle={subtitle}
        email={session?.email}
        groups={groups}
        onSignOut={() => void signOut()}
      />
      <PortalMobileHeader
        ariaLabel="Portal da clínica"
        title={title}
        subtitle={subtitle}
        email={session?.email}
        groups={groups}
        onSignOut={() => void signOut()}
      />
      <main id="conteudo" className={portalMainClass}>
        {/* Sem pesquisa global para o Médico (BR-CLN-39). */}
        {!isDoctor && <ClinicSearch />}
        <Outlet />
      </main>
    </div>
  )
}
