import { Navigate } from 'react-router-dom'
import { LockKeyhole } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PortalLoginScreen } from '@/components/layout/PortalLoginScreen'
import { useAuth } from '@/contexts/AuthContext'
import { usePageTitle } from '@/hooks/usePageTitle'
import { paths } from '@/routes/paths'

/**
 * Entrada do backoffice (Platform Admin). Usa a mesma sessão de `User` da app, mas só deixa seguir
 * contas com o papel de administrador da plataforma; qualquer outra sessão é recusada aqui, sem
 * ser enviada para a app de família.
 */
export function BackofficeLoginPage() {
  usePageTitle('Backoffice')
  const { user, login, logout } = useAuth()

  if (user?.platformRole === 'PLATFORM_ADMIN') return <Navigate to={paths.admin} replace />

  return (
    <PortalLoginScreen
      badge="Acesso interno"
      badgeIcon={LockKeyhole}
      title="Backoffice"
      submitLabel="Entrar no backoffice"
      login={login}
      notice={
        user ? (
          <div role="alert" className="mt-8 flex flex-col gap-4 rounded-2xl bg-warning-soft p-5">
            <p className="text-lg font-semibold">Esta conta não tem acesso ao backoffice.</p>
            <p className="text-base">
              Tem a sessão iniciada como {user.email}. Termine-a e entre com uma conta de administrador da plataforma.
            </p>
            <Button variant="secondary" size="lg" onClick={() => logout()}>
              Terminar sessão
            </Button>
          </div>
        ) : undefined
      }
    />
  )
}
