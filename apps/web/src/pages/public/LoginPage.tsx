import { useRef, useState, type KeyboardEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, Mail } from 'lucide-react'
import { z } from 'zod'
import { LogoMark } from '@/components/layout/Logo'
import { Button } from '@/components/ui/Button'
import { Input, PasswordInput } from '@/components/ui/Input'
import { FormError, FullScreenLoader } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useProfessionalAuth } from '@/contexts/ProfessionalAuthContext'
import { usePageTitle } from '@/hooks/usePageTitle'
import { cn } from '@/lib/cn'
import { errorMessage, isAppError } from '@/lib/errors'
import { useSignedInTarget } from '@/routes/guards'
import { paths } from '@/routes/paths'
import { LoginBackground } from './LoginBackground'

const schema = z.object({
  email: z.email('Introduza um e-mail válido.'),
  password: z.string().min(1, 'Introduza a palavra-passe.'),
})

type FormValues = z.infer<typeof schema>

type LoginKind = 'familia' | 'profissional'

interface TabDefinition {
  kind: LoginKind
  label: string
  subtitle: string
  forgot: { label: string; to: string }
  footer: { prefix: string; label: string; to: string }
}

/** Texto simples para a família; cada separador liga ao fluxo (recuperar, registar) do seu lado. */
const TABS: TabDefinition[] = [
  {
    kind: 'familia',
    label: 'Família',
    subtitle: 'Bem-vindo de volta.',
    forgot: { label: 'Esqueceu a palavra-passe?', to: paths.forgotPassword },
    footer: { prefix: 'Ainda não tem conta?', label: 'Criar conta', to: paths.register },
  },
  {
    kind: 'profissional',
    label: 'Médico ou especialista',
    subtitle: 'Entre na sua área de profissional.',
    forgot: { label: 'Esqueci-me da palavra-passe', to: paths.professionalForgot },
    footer: { prefix: 'Ainda não tem conta?', label: 'Registar-se como profissional', to: paths.professionalRegister },
  },
]

const FAMILY_TAB = TABS[0] as TabDefinition

/** `?tipo=` → separador (omissão: família). */
function kindFrom(value: string | null): LoginKind {
  return value === 'profissional' ? 'profissional' : 'familia'
}

/** Destino pedido por ligação (`next`/`returnTo`): só caminhos internos, nunca outro sítio nem o próprio login. */
function safeInternalPath(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null
  if (raw === paths.enter || raw.startsWith(`${paths.enter}?`) || raw.startsWith(paths.loginLegacy)) return null
  return raw
}

/**
 * Ecrã único de entrada (família e médico/especialista), com separador. Cada separador usa a sua própria
 * autenticação e sessão (ADR-037): nada é partilhado entre eles, e o painel inativo nem existe no DOM —
 * por isso mudar de separador limpa erros e palavra-passe.
 */
export function LoginPage() {
  usePageTitle('Entrar')
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const { status: familyStatus, user } = useAuth()
  const { status: professionalStatus, session } = useProfessionalAuth()
  const kind = kindFrom(params.get('tipo'))
  const requested = safeInternalPath(params.get('next') ?? params.get('returnTo'))
  const stateFrom = (location.state as { from?: string } | null)?.from
  const from = stateFrom ?? requested
  const familyTarget = useSignedInTarget(requested)
  const tabRefs = useRef<Record<LoginKind, HTMLButtonElement | null>>({ familia: null, profissional: null })

  if (familyStatus === 'loading' || (kind === 'profissional' && professionalStatus === 'loading')) return <FullScreenLoader />
  if (kind === 'familia' && user) return <Navigate to={familyTarget} replace />
  if (kind === 'profissional' && session) {
    return <Navigate to={from?.startsWith(paths.professional) ? from : paths.professional} replace />
  }

  function select(next: LoginKind, focus = false) {
    if (focus) tabRefs.current[next]?.focus()
    if (next === kind) return
    const search = new URLSearchParams(params)
    search.set('tipo', next)
    setParams(search, { replace: true, state: location.state })
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = TABS.findIndex((tab) => tab.kind === kind)
    const move: Record<string, number> = {
      ArrowRight: (index + 1) % TABS.length,
      ArrowLeft: (index - 1 + TABS.length) % TABS.length,
      Home: 0,
      End: TABS.length - 1,
    }
    if (!(event.key in move)) return
    event.preventDefault()
    select(TABS[move[event.key] ?? 0]?.kind ?? 'familia', true)
  }

  const active = TABS.find((tab) => tab.kind === kind) ?? FAMILY_TAB

  return (
    <div className="relative flex min-h-dvh flex-col md:items-center md:justify-center md:py-10">
      <LoginBackground />

      <Link
        to={paths.splash}
        aria-label="Voltar"
        className="absolute top-[max(0.5rem,var(--safe-top))] left-2.5 z-10 flex size-11 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15"
      >
        <ArrowLeft className="size-5" aria-hidden />
      </Link>

      <div className="relative flex min-h-32 flex-1 flex-col items-center justify-center gap-3 px-6 pt-safe text-white md:flex-none md:pb-8">
        <LogoMark tone="inverse" className="size-14 drop-shadow-lg" />
        <p className="text-[1.25rem] font-bold tracking-tight drop-shadow">Vita Family</p>
      </div>

      <div className="relative rounded-t-3xl bg-surface px-5 pt-6 pb-[max(1.25rem,var(--safe-bottom))] shadow-overlay md:w-full md:max-w-md md:rounded-3xl md:px-8 md:py-8">
        <div className="flex flex-col gap-1 pb-4">
          <h1 className="text-[1.25rem] leading-tight font-bold tracking-tight">Entrar</h1>
          <p className="text-muted">{active.subtitle}</p>
        </div>

        <div role="tablist" aria-label="Tipo de conta" className="mb-5 grid grid-cols-2 gap-1 rounded-full bg-surface-muted p-1">
          {TABS.map((tab) => {
            const selected = tab.kind === kind
            return (
              <button
                key={tab.kind}
                ref={(element) => {
                  tabRefs.current[tab.kind] = element
                }}
                type="button"
                role="tab"
                id={`login-tab-${tab.kind}`}
                aria-selected={selected}
                aria-controls={`login-panel-${tab.kind}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => select(tab.kind)}
                onKeyDown={onKeyDown}
                className={cn(
                  'min-h-11 rounded-full px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                  selected ? 'bg-surface text-primary shadow-card' : 'text-muted hover:text-foreground',
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

        <div role="tabpanel" id={`login-panel-${kind}`} aria-labelledby={`login-tab-${kind}`}>
          {kind === 'familia' ? <FamilyLoginForm key="familia" tab={active} /> : <ProfessionalLoginForm key="profissional" tab={active} />}
        </div>
      </div>
    </div>
  )
}

function FamilyLoginForm({ tab }: { tab: TabDefinition }) {
  const { login } = useAuth()
  const navigate = useNavigate()
  // O redirecionamento depois de entrar é feito por `LoginPage` (a sessão passa a existir).
  return (
    <LoginForm
      tab={tab}
      login={login}
      onError={(error) => {
        if (isAppError(error, 'EMAIL_NOT_VERIFIED')) {
          navigate(paths.verify)
          return null
        }
        return errorMessage(error)
      }}
    />
  )
}

function ProfessionalLoginForm({ tab }: { tab: TabDefinition }) {
  const { login } = useProfessionalAuth()
  return <LoginForm tab={tab} login={login} onError={errorMessage} />
}

interface LoginFormProps {
  tab: TabDefinition
  login: (email: string, password: string) => Promise<void>
  /** Mensagem a mostrar (ou `null` se o erro foi tratado por navegação). */
  onError: (error: unknown) => string | null
}

function LoginForm({ tab, login, onError }: LoginFormProps) {
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  async function onSubmit({ email, password }: FormValues) {
    setFormError(null)
    try {
      await login(email, password)
    } catch (error) {
      setFormError(onError(error))
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      <Input
        label="E-mail"
        type="email"
        icon={Mail}
        placeholder="nome@exemplo.com"
        autoComplete="email"
        error={errors.email?.message}
        {...register('email')}
      />
      <PasswordInput
        label="Palavra-passe"
        placeholder="A sua palavra-passe"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register('password')}
      />
      <Link to={tab.forgot.to} className="-mt-1 self-end text-sm font-semibold text-primary hover:underline">
        {tab.forgot.label}
      </Link>
      <FormError message={formError} />
      <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
        Entrar
      </Button>
      <p className="text-center text-base text-muted">
        {tab.footer.prefix}{' '}
        <Link to={tab.footer.to} className="font-semibold text-primary hover:underline">
          {tab.footer.label}
        </Link>
      </p>
      <p className="text-center text-sm text-muted">
        <Link to={paths.clinicLogin} className="hover:text-foreground hover:underline">
          Portal da clínica
        </Link>
        {' · '}
        <Link to={paths.backofficeLogin} className="hover:text-foreground hover:underline">
          Acesso interno
        </Link>
      </p>
    </form>
  )
}
