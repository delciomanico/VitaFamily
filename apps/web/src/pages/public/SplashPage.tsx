import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { BrandLoader } from '@/components/ui/BrandLoader'
import { useAuth } from '@/contexts/AuthContext'
import { preferences } from '@/lib/storage'
import { paths } from '@/routes/paths'

/** Duração da animação da marca (a última letra termina por volta dos 2 s). */
const SPLASH_MIN_MS = 2100

function useMinimumDelay(ms: number) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setDone(true), ms)
    return () => window.clearTimeout(timer)
  }, [ms])
  return done
}

/** Splash da app instalada: a mesma animação de carregamento da marca usada no site. */
export function SplashPage() {
  const { status, user, family } = useAuth()
  const delayDone = useMinimumDelay(SPLASH_MIN_MS)

  if (delayDone && status === 'ready') {
    if (user) return <Navigate to={family ? paths.home : paths.setupFamily} replace />
    return <Navigate to={preferences.hasSeenOnboarding() ? paths.login : paths.onboarding} replace />
  }

  return (
    <div className="fixed inset-0 z-50">
      <BrandLoader label="A iniciar…" />
    </div>
  )
}
