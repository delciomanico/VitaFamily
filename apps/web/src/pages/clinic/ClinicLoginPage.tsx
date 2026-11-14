import { Stethoscope } from 'lucide-react'
import { PortalLoginScreen } from '@/components/layout/PortalLoginScreen'
import { useClinicAuth } from '@/contexts/ClinicAuthContext'
import { usePageTitle } from '@/hooks/usePageTitle'
import { paths } from '@/routes/paths'

/**
 * Login do **portal da clínica** (`POST /clinic-portal/auth/login`, D18/ADR-020), em rota própria
 * (`/clinic/login`) e fora do fluxo de login da app de família: são contas (`ClinicAccount`) de um
 * espaço de identidade separado. O redirecionamento após entrar é feito pelo guard `ClinicGuestOnly`.
 */
export function ClinicLoginPage() {
  usePageTitle('Portal da clínica')
  const { login } = useClinicAuth()
  return (
    <PortalLoginScreen
      badge="Portal da clínica"
      badgeIcon={Stethoscope}
      title="Entrar na área da clínica"
      images={['/images/site/consulta.webp', '/images/site/recepcao.webp']}
      emailLabel="E-mail da conta da clínica"
      emailPlaceholder="nome@clinica.pt"
      footerLink={{ prefix: 'Sem acesso?', label: 'Solicitar acesso', to: paths.requestAccess('clinica') }}
      login={login}
    />
  )
}
