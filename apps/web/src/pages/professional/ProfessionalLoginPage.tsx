import { BriefcaseMedical } from 'lucide-react'
import { PortalLoginScreen } from '@/components/layout/PortalLoginScreen'
import { useProfessionalAuth } from '@/contexts/ProfessionalAuthContext'
import { usePageTitle } from '@/hooks/usePageTitle'
import { paths } from '@/routes/paths'

/**
 * Login do **portal do profissional** (`POST /professional-portal/auth/login`, UC-MKT-02), em rota própria
 * (`/profissional/entrar`): conta de um espaço de identidade separado (ADR-037). Funciona em todos os
 * estados de validação (`SUSPENDED`/`REJECTED` entram em só leitura, OP-59); o redirecionamento depois de
 * entrar é do guard `ProfessionalGuestOnly`.
 */
export function ProfessionalLoginPage() {
  usePageTitle('Portal do profissional')
  const { login } = useProfessionalAuth()
  return (
    <PortalLoginScreen
      badge="Portal do profissional"
      badgeIcon={BriefcaseMedical}
      title="Entrar na área do profissional"
      emailLabel="E-mail da conta de profissional"
      emailPlaceholder="nome@exemplo.ao"
      forgotLink={{ label: 'Esqueci-me da palavra-passe', to: paths.professionalForgot }}
      footerLink={{ prefix: 'Ainda não tem conta?', label: 'Registar-se como profissional', to: paths.professionalRegister }}
      login={login}
    />
  )
}
