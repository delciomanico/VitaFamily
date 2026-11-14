import { Landmark } from 'lucide-react'
import { PortalLoginScreen } from '@/components/layout/PortalLoginScreen'
import { useInsuranceAuth } from '@/contexts/InsuranceAuthContext'
import { usePageTitle } from '@/hooks/usePageTitle'
import { paths } from '@/routes/paths'

/**
 * Login do **portal da seguradora** (`POST /insurance-portal/auth/login`, ADR-021), em rota própria
 * (`/insurance/login`): `InsuranceAccount` é um espaço de identidade separado do de `User` e do da
 * clínica. O redirecionamento após entrar é feito pelo guard `InsuranceGuestOnly`.
 */
export function InsuranceLoginPage() {
  usePageTitle('Portal da seguradora')
  const { login } = useInsuranceAuth()
  return (
    <PortalLoginScreen
      badge="Portal da seguradora"
      badgeIcon={Landmark}
      title="Entrar na área da seguradora"
      tagline="Beneficiários e clínicas ligados, sem papel."
      images={['/images/site/recepcao.webp', '/images/site/medicacao.webp']}
      emailLabel="E-mail da conta da seguradora"
      emailPlaceholder="nome@seguradora.pt"
      passwordPlaceholder="A sua palavra-passe"
      requestAccessTo={paths.requestAccess('seguradora')}
      login={login}
    />
  )
}
