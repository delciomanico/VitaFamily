import { Outlet, useNavigate } from 'react-router-dom'
import { BadgeCheck, Building2, Tags, Users } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { paths } from '@/routes/paths'
import { PortalMobileHeader } from './PortalMobileHeader'
import { PortalSidebar, portalMainClass } from './PortalSidebar'

/**
 * Área do Platform Admin (`/admin/*`): faixa com a conta em sessão e Sair, e separadores
 * Contas / Clínicas. Mesma sessão de `User` da app de família (ver `admin.service.ts`), mas
 * nunca mostra nada de família — a conta de Platform Admin não tem uma.
 */
export function AdminShell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const groups = [
    {
      items: [
        { to: paths.admin, label: 'Contas', icon: Users, end: true },
        { to: paths.adminClinics, label: 'Clínicas', icon: Building2, end: false },
        { to: paths.adminProfessionals, label: 'Profissionais', icon: BadgeCheck, end: false },
        { to: paths.adminSpecialties, label: 'Especialidades', icon: Tags, end: false },
      ],
    },
  ]

  function signOut() {
    logout()
    navigate(paths.login, { replace: true })
  }

  return (
    <div className="min-h-dvh">
      <PortalSidebar
        ariaLabel="Administração"
        title="Administração"
        subtitle="Platform Admin"
        email={user?.email}
        groups={groups}
        onSignOut={signOut}
      />
      <PortalMobileHeader
        ariaLabel="Administração"
        title="Administração"
        subtitle={user?.email}
        groups={groups}
        onSignOut={signOut}
      />
      <main id="conteudo" className={portalMainClass}>
        <Outlet />
      </main>
    </div>
  )
}
