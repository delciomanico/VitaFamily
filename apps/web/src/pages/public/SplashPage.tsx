import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { LoaderCircle } from 'lucide-react'
import { Logo } from '@/components/layout/Logo'
import { useAuth } from '@/contexts/AuthContext'
import { preferences } from '@/lib/storage'
import { paths } from '@/routes/paths'

/** Tempo mínimo do splash, para não piscar quando a sessão restaura logo. */
const SPLASH_MIN_MS = 1200

function useMinimumDelay(ms: number) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setDone(true), ms)
    return () => window.clearTimeout(timer)
  }, [ms])
  return done
}

export function SplashPage() {
  const { status, user, family } = useAuth()
  const delayDone = useMinimumDelay(SPLASH_MIN_MS)

  if (delayDone && status === 'ready') {
    if (user) return <Navigate to={family ? paths.home : paths.setupFamily} replace />
    return <Navigate to={preferences.hasSeenOnboarding() ? paths.login : paths.onboarding} replace />
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <Logo size="lg" className="flex-col" />
      {/* TBD: slogan oficial não definido na especificação. */}
      <p className="text-muted">A saúde da sua família, organizada.</p>
      <div role="status" className="mt-8">
        <LoaderCircle className="size-6 animate-spin text-primary" aria-hidden />
        <span className="sr-only">A iniciar…</span>
      </div>
    </div>
  )
}
