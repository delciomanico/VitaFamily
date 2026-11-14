import { useAuth } from '@/contexts/AuthContext'
import { paths } from '@/routes/paths'

/** Para onde leva «Abrir a app» quando há sessão de família/admin; `null` sem sessão. */
export function useAppEntry(): string | null {
  const { user, family } = useAuth()
  if (!user) return null
  if (user.platformRole === 'PLATFORM_ADMIN') return paths.admin
  return family ? paths.home : paths.setupFamily
}
