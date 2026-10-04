import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { FullScreenLoader } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { paths } from './paths'

interface FromState {
  from?: string
}

/** Destino depois de entrar: a página pedida, a Home ou a configuração da família. */
function useSignedInTarget(): string {
  const { family } = useAuth()
  const from = (useLocation().state as FromState | null)?.from
  if (!family) return paths.setupFamily
  return from ?? paths.home
}

/** Área autenticada: sem sessão → login (lembrando a página pedida). */
export function RequireAuth() {
  const { status, user } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <FullScreenLoader />
  if (!user) return <Navigate to={paths.login} replace state={{ from: location.pathname } satisfies FromState} />
  return <Outlet />
}

/** Área da app: exige pertencer a uma família (os dados são sempre por família). */
export function RequireFamily() {
  const { family } = useAuth()
  if (!family) return <Navigate to={paths.setupFamily} replace />
  return <Outlet />
}

/** Login, registo e recuperação: quem já tem sessão segue para a app. */
export function GuestOnly() {
  const { status, user } = useAuth()
  const target = useSignedInTarget()
  if (status === 'loading') return <FullScreenLoader />
  if (user) return <Navigate to={target} replace />
  return <Outlet />
}

/** Verificação: só existe com um e-mail à espera de código. */
export function RequirePendingVerification() {
  const { status, user, pendingEmail } = useAuth()
  const target = useSignedInTarget()
  if (status === 'loading') return <FullScreenLoader />
  if (user) return <Navigate to={target} replace />
  if (!pendingEmail) return <Navigate to={paths.register} replace />
  return <Outlet />
}
