import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Mail, Ticket, UserPlus } from 'lucide-react'
import { AuthScreen } from '@/components/layout/AuthScreen'
import { LogoMark } from '@/components/layout/Logo'
import { Button, ButtonLink } from '@/components/ui/Button'
import { ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { errorMessage } from '@/lib/errors'
import { formatLongDate } from '@/lib/format'
import { paths } from '@/routes/paths'
import { familyService, type InvitationPreview } from '@/services/family.service'

const typeLabel: Record<InvitationPreview['type'], string> = {
  MEMBER: 'Membro da família',
  DEPENDENT_ACCOUNT: 'Conta de dependente',
}

/**
 * Ecrã público de "Entrar numa família" por convite (link `/invite/accept?token=...`,
 * docs/05-api/openapi.yaml `/invitations/lookup` e `/invitations/accept`). O token nunca é um
 * "código" escolhido pelo utilizador — chega sempre por e-mail.
 */
export function InviteAcceptPage() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const navigate = useNavigate()
  const { status, user, acceptInvitation, logout } = useAuth()

  const [preview, setPreview] = useState<InvitationPreview | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)

  const load = useCallback(() => {
    if (!token) {
      setLoading(false)
      setLoadError(new Error('missing-token'))
      return
    }
    setLoading(true)
    setLoadError(null)
    familyService
      .lookupInvitation(token)
      .then(setPreview)
      .catch(setLoadError)
      .finally(() => setLoading(false))
  }, [token])

  useEffect(load, [load])

  async function onAccept() {
    if (!token) return
    setAccepting(true)
    setAcceptError(null)
    try {
      await acceptInvitation(token)
      navigate(paths.home, { replace: true })
    } catch (error) {
      setAcceptError(errorMessage(error))
      setAccepting(false)
    }
  }

  function goToLogin() {
    navigate(paths.login, { state: { from: `${paths.inviteAccept}?token=${token}` } })
  }

  function goToRegister() {
    navigate(`${paths.register}?invitationToken=${encodeURIComponent(token ?? '')}`)
  }

  const screen = (children: ReactNode, title = 'Convite para família') => (
    <AuthScreen title={title} leading={<LogoMark className="mb-4 size-14" />}>
      {children}
    </AuthScreen>
  )

  if (status === 'loading' || loading) {
    return screen(<LoadingState rows={2} label="A verificar o convite…" />)
  }

  if (loadError || !preview) {
    const message = token ? errorMessage(loadError) : 'Este link de convite está incompleto.'
    return screen(
      <ErrorState message={message} />,
      'Convite inválido',
    )
  }

  const matchesSession = user && user.email.trim().toLowerCase() === preview.invitedEmail.trim().toLowerCase()

  return screen(
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        <Row icon={Ticket} label="Família" value={preview.familyName} />
        <Row icon={Mail} label="Convidado" value={preview.invitedEmail} />
        <Row icon={UserPlus} label="Tipo de convite" value={typeLabel[preview.type]} />
        <p className="text-sm text-muted">Válido até {formatLongDate(preview.expiresAt)}.</p>
      </div>

      {user ? (
        matchesSession ? (
          <div className="flex flex-col gap-3">
            <FormError message={acceptError} />
            <Button size="lg" fullWidth loading={accepting} onClick={onAccept}>
              Aceitar convite
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Este convite foi enviado para <strong>{preview.invitedEmail}</strong>, mas a sessão atual é de{' '}
              <strong>{user.email}</strong>. Saia e entre (ou crie conta) com o e-mail convidado.
            </p>
            <Button variant="secondary" size="lg" fullWidth onClick={logout}>
              Sair da sessão atual
            </Button>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">Para aceitar, entre com a sua conta ou crie uma nova com este e-mail.</p>
          <Button size="lg" fullWidth onClick={goToLogin}>
            Já tenho conta: entrar
          </Button>
          <Button variant="secondary" size="lg" fullWidth onClick={goToRegister}>
            Criar conta
          </Button>
        </div>
      )}

      <ButtonLink variant="ghost" size="sm" to={paths.splash} className="self-center">
        Voltar ao início
      </ButtonLink>
    </div>,
  )
}

function Row({ icon: Icon, label, value }: { icon: typeof Ticket; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted">{label}</span>
        <span className="block truncate font-medium">{value}</span>
      </span>
    </div>
  )
}
