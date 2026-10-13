import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { FullScreenLoader } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useClinicAuth } from '@/contexts/ClinicAuthContext'
import { paths } from './paths'

interface FromState {
  from?: string
}

/** Destino depois de entrar: a página pedida, a Home ou a configuração da família. */
function useSignedInTarget(): string {
  const { family } = useAuth()
  const from = (useLocation().state as FromState | null)?.from
  // Login a meio de "Entrar numa família" por convite: volta para lá para concluir o accept,
  // mesmo sem família ainda (é precisamente o que esta tela vai estabelecer).
  if (from?.startsWith(paths.inviteAccept)) return from
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

/**
 * Portal da clínica (D17/D18): exige uma sessão de `ClinicAccount` — nunca a de `User`
 * (ADR-020). Sem sessão de clínica vai para o login do portal, não para o login da app.
 */
export function RequireClinicAccount() {
  const { status, session } = useClinicAuth()
  const location = useLocation()
  if (status === 'loading') return <FullScreenLoader />
  if (!session) {
    return <Navigate to={paths.clinicLogin} replace state={{ from: location.pathname } satisfies FromState} />
  }
  return <Outlet />
}

/** Gestão de contas da clínica: só o Admin da clínica (BR-CLN-05). */
export function RequireClinicAdmin() {
  const { isAdmin } = useClinicAuth()
  if (!isAdmin) return <Navigate to={paths.clinic} replace />
  return <Outlet />
}

/** Login do portal: com sessão de clínica já iniciada, segue para os pedidos. */
export function ClinicGuestOnly() {
  const { status, session } = useClinicAuth()
  const from = (useLocation().state as FromState | null)?.from
  if (status === 'loading') return <FullScreenLoader />
  if (session) return <Navigate to={from?.startsWith(paths.clinic) ? from : paths.clinic} replace />
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
