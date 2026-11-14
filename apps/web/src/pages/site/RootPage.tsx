import { Navigate } from 'react-router-dom'
import { SiteFrame } from '@/components/layout/PublicSiteLayout'
import { FullScreenLoader } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { paths } from '@/routes/paths'
import { SplashPage } from '@/pages/public/SplashPage'
import { LandingPage } from './LandingPage'

/** Aplicação instalada (PWA em ecrã inteiro ou Capacitor): mantém o splash e o onboarding. */
export function isInstalledApp(): boolean {
  if (typeof window === 'undefined') return false
  if ('Capacitor' in window) return true
  return Boolean(window.matchMedia?.('(display-mode: standalone)').matches)
}

/**
 * Raiz `/`. No browser é o site público (landing); quem já tem sessão segue direto para a app
 * (ou configuração da família, ou administração). Instalada, usa o splash de sempre.
 */
export function RootPage() {
  const { status, user, family } = useAuth()
  if (isInstalledApp()) return <SplashPage />
  if (status === 'loading') return <FullScreenLoader />
  if (user) {
    if (user.platformRole === 'PLATFORM_ADMIN') return <Navigate to={paths.admin} replace />
    return <Navigate to={family ? paths.home : paths.setupFamily} replace />
  }
  return (
    <SiteFrame>
      <LandingPage />
    </SiteFrame>
  )
}
