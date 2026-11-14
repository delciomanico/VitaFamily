import { SiteFrame } from '@/components/layout/PublicSiteLayout'
import { FullScreenLoader } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { SplashPage } from '@/pages/public/SplashPage'
import { LandingPage } from './LandingPage'

/** Aplicação instalada (PWA em ecrã inteiro ou Capacitor): mantém o splash e o onboarding. */
export function isInstalledApp(): boolean {
  if (typeof window === 'undefined') return false
  if ('Capacitor' in window) return true
  return Boolean(window.matchMedia?.('(display-mode: standalone)').matches)
}

/**
 * Raiz `/`. No browser é sempre o site público: quem já tem sessão vê a mesma landing, com um
 * botão «Abrir a app» no cabeçalho em vez de ser enviado para dentro da app. Instalada, usa o splash.
 */
export function RootPage() {
  const { status } = useAuth()
  if (isInstalledApp()) return <SplashPage />
  if (status === 'loading') return <FullScreenLoader />
  return (
    <SiteFrame>
      <LandingPage />
    </SiteFrame>
  )
}
