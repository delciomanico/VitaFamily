import { Outlet, useNavigate } from 'react-router-dom'
import {
  Building2,
  ClipboardList,
  FileText,
  Inbox,
  Link2,
  Stethoscope,
  Upload,
  UserRound,
  Users,
  Layers,
} from 'lucide-react'
import { InsuranceAuthProvider, useInsuranceAuth } from '@/contexts/InsuranceAuthContext'
import { paths } from '@/routes/paths'
import { insuranceRole } from '@/types/insurance'
import { PortalMobileHeader } from './PortalMobileHeader'
import { PortalSidebar, portalMainClass, type PortalNavGroup } from './PortalSidebar'

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

/** Portal da seguradora: barra lateral/menu agrupados conforme o papel (§8.2b). */
export function InsuranceShell() {
  const { session, me, moduleEnabled, isAdmin, isOps, canSeeClaims, logout } = useInsuranceAuth()
  const navigate = useNavigate()

  // O que o papel pode usar (§8.2b); a decisão real é do servidor, isto só poupa cliques inúteis.
  // Módulo operacional desativado: sem entradas operacionais (as páginas mantêm o estado vazio por URL).
  const groups: PortalNavGroup[] = [
    {
      items: canSeeClaims ? [{ to: paths.insurance, label: 'Pedidos', icon: Inbox, end: true }] : [],
    },
    {
      title: 'Beneficiários',
      items:
        isOps && moduleEnabled
          ? [
              { to: paths.insuranceBeneficiaries, label: 'Beneficiários', icon: UserRound, end: false },
              { to: paths.insurancePolicies, label: 'Apólices', icon: FileText, end: false },
              { to: paths.insuranceLinks, label: 'Ligações', icon: Link2, end: false },
              { to: paths.insuranceImports, label: 'Importação', icon: Upload, end: false },
              { to: paths.insuranceCompanies, label: 'Empresas', icon: Building2, end: false },
            ]
          : [],
    },
    {
      title: 'Planos e rede',
      items: [
        ...(isOps && moduleEnabled
          ? [
              { to: paths.insurancePlans, label: 'Planos', icon: Layers, end: false },
              { to: paths.insuranceServices, label: 'Serviços', icon: ClipboardList, end: false },
            ]
          : []),
        ...(isAdmin && moduleEnabled ? [{ to: paths.insuranceProviders, label: 'Clínicas', icon: Stethoscope, end: false }] : []),
      ],
    },
    {
      title: 'Gestão',
      items: isAdmin ? [{ to: paths.insuranceAgents, label: 'Contas', icon: Users, end: false }] : [],
    },
  ]

  async function signOut() {
    await logout()
    navigate(paths.insuranceLogin, { replace: true })
  }

  return (
    <div className="min-h-dvh">
      <PortalSidebar
        ariaLabel="Portal da seguradora"
        title={me?.name ?? 'Portal da seguradora'}
        subtitle={session ? insuranceRole[session.role] : undefined}
        email={session?.email}
        groups={groups}
        onSignOut={() => void signOut()}
      />
      <PortalMobileHeader
        ariaLabel="Portal da seguradora"
        title={me?.name ?? session?.email ?? 'Portal da seguradora'}
        subtitle={session ? insuranceRole[session.role] : undefined}
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
