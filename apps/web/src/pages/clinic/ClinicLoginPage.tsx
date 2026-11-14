import { Stethoscope } from 'lucide-react'
import { PortalLoginScreen } from '@/components/layout/PortalLoginScreen'
import { useClinicAuth } from '@/contexts/ClinicAuthContext'
import { usePageTitle } from '@/hooks/usePageTitle'
import { paths } from '@/routes/paths'

/**
 * Login do **portal da clínica** (`POST /clinic-portal/auth/login`, D18/ADR-020), em rota própria
 * (`/clinic/login`) e fora do fluxo de login da app de família: são contas (`ClinicAccount`) de um
 * espaço de identidade separado, sem relação com as contas de utilizador nem com famílias.
 * O redirecionamento após entrar é feito pelo guard `ClinicGuestOnly`.
 */
export function ClinicLoginPage() {
  usePageTitle('Portal da clínica')
  const { login } = useClinicAuth()
  return (
    <PortalLoginScreen
      badge="Portal da clínica"
      badgeIcon={Stethoscope}
      title="Entrar na área da clínica"
      intro="Pedidos de consulta, agenda e horários das clínicas parceiras. É uma conta diferente da conta da aplicação Vita Family."
      tagline="A sua agenda, os seus pacientes, tudo num só portal."
      highlights={['Agenda e vagas por profissional', 'Pacientes ligados com consentimento', 'Relatórios, laudos e recibos']}
      images={['/images/site/consulta.webp', '/images/site/recepcao.webp']}
      emailLabel="E-mail da conta da clínica"
      emailPlaceholder="nome@clinica.pt"
      passwordPlaceholder="A sua palavra-passe"
      lostAccess="Perdeu o acesso de Admin da clínica? Contacte a equipa Vita Family — só ela repõe essa conta."
      requestAccessTo={paths.requestAccess('clinica')}
      login={login}
    />
  )
}
