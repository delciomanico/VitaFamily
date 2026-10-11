import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronRight, House, Mail, type LucideIcon } from 'lucide-react'
import { z } from 'zod'
import { AuthFooter, AuthScreen } from '@/components/layout/AuthScreen'
import { LogoMark } from '@/components/layout/Logo'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { FormError } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { errorMessage } from '@/lib/errors'
import { paths } from '@/routes/paths'
import { SETUP_STEPS } from './steps'

type Mode = 'create' | 'join'

function parseMode(value: string | null): Mode | null {
  return value === 'create' || value === 'join' ? value : null
}

export function SetupFamilyPage() {
  const [params] = useSearchParams()
  const mode = parseMode(params.get('mode'))
  if (mode === 'create') return <CreateFamily />
  // "Entrar numa família": não existe um código a introduzir aqui (openapi.yaml não tem esse
  // fluxo) — só o link de convite por e-mail (`/invite/accept?token=...`), ver JoinByInviteInfo.
  if (mode === 'join') return <JoinByInviteInfo />
  return <ChooseStart />
}

function ChooseStart() {
  const { logout } = useAuth()
  return (
    <AuthScreen
      title="Bem-vindo ao Vita Family"
      description="Como deseja começar?"
      leading={<LogoMark className="mb-4 size-14" />}
    >
      <div className="flex flex-col gap-3">
        <StartOption
          to="?mode=create"
          icon={House}
          title="Criar uma família"
          description="Comece do zero e convide quem quiser."
        />
        <StartOption
          to="?mode=join"
          icon={Mail}
          title="Entrar numa família"
          description="Abra o link de convite que recebeu por e-mail."
        />
      </div>
      <AuthFooter>
        <Button variant="soft" size="lg" fullWidth onClick={logout}>
          Sair
        </Button>
      </AuthFooter>
    </AuthScreen>
  )
}

interface StartOptionProps {
  to: string
  icon: LucideIcon
  title: string
  description: string
}

function StartOption({ to, icon: Icon, title, description }: StartOptionProps) {
  return (
    <Link
      to={to}
      className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-primary active:bg-surface-muted"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
        <Icon className="size-6" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-muted">{description}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
    </Link>
  )
}

const createSchema = z.object({
  name: z.string().trim().min(2, 'Introduza o nome da família.'),
})

function CreateFamily() {
  const { createFamily } = useAuth()
  const navigate = useNavigate()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof createSchema>>({
    resolver: zodResolver(createSchema),
  })

  async function onSubmit({ name }: z.infer<typeof createSchema>) {
    setFormError(null)
    try {
      await createFamily(name)
      navigate(paths.setupHealth)
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  return (
    <AuthScreen
      title="Criar família"
      description="Dê um nome à sua família."
      backTo={paths.setupFamily}
      progress={{ step: 1, total: SETUP_STEPS.create }}
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-1 flex-col">
        <div className="flex flex-col gap-4">
          <Input
            label="Nome da família"
            icon={House}
            placeholder="Ex.: Família Silva"
            error={errors.name?.message}
            {...register('name')}
          />
          <FormError message={formError} />
        </div>
        <AuthFooter>
          <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
            Continuar
          </Button>
        </AuthFooter>
      </form>
    </AuthScreen>
  )
}

/**
 * Convites são sempre por e-mail com um link (`/invite/accept?token=...`), nunca um código a
 * introduzir à mão (openapi.yaml `/invitations/lookup` e `/invitations/accept` — ver
 * `pages/public/InviteAcceptPage.tsx`). Esta tela só explica isso; quem convida é tratado noutra
 * tarefa (ecrã de administração, fora de âmbito aqui).
 */
function JoinByInviteInfo() {
  return (
    <AuthScreen
      title="Entrar numa família"
      description="Os convites chegam por e-mail, com um link para aceitar."
      backTo={paths.setupFamily}
      progress={{ step: 1, total: SETUP_STEPS.join }}
    >
      <div className="flex flex-1 flex-col gap-4">
        <p className="text-sm text-muted">
          Peça a um Admin da família para o(a) convidar. Vai receber um e-mail com um link — basta abri-lo para ver os
          dados do convite e entrar na família.
        </p>
      </div>
    </AuthScreen>
  )
}
