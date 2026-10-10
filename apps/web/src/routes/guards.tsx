import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { FullScreenLoader } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { paths } from './paths'

interface FromState {
  from?: string
}

/** Destino depois de entrar: o portal da clínica, a página pedida, a Home ou a configuração da família. */
function useSignedInTarget(): string {
  const { family, clinic } = useAuth()
  const from = (useLocation().state as FromState | null)?.from
  if (clinic && !family) return from?.startsWith(paths.clinic) ? from : paths.clinic
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
  const { family, clinic } = useAuth()
  if (!family) return <Navigate to={clinic ? paths.clinic : paths.setupFamily} replace />
  return <Outlet />
}

/** Portal da clínica: só para Gestores de uma clínica parceira (D17). */
export function RequireClinic() {
  const { clinic } = useAuth()
  if (!clinic) return <Navigate to={paths.home} replace />
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
