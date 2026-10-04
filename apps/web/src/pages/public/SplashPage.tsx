import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { LoaderCircle } from 'lucide-react'
import { LogoMark } from '@/components/layout/Logo'
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
    <div className="fixed inset-0 flex flex-col items-center bg-brand pt-safe pb-[max(3rem,env(safe-area-inset-bottom))] text-white">
      <div className="flex flex-1 flex-col items-center justify-center gap-5">
        <LogoMark tone="inverse" className="size-24 drop-shadow-lg" />
        <p className="text-[1.75rem] font-bold tracking-tight">Vita Family</p>
      </div>
      <div role="status">
        <LoaderCircle className="size-9 animate-spin" strokeWidth={2.5} aria-hidden />
        <span className="sr-only">A iniciar…</span>
      </div>
    </div>
  )
}
