import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronRight, House, Ticket, type LucideIcon } from 'lucide-react'
import { z } from 'zod'
import { DemoHint, demoInvitationCode } from '@/components/domain/DemoHint'
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
  if (mode === 'join') return <JoinFamily />
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
          icon={Ticket}
          title="Entrar numa família"
          description="Use o código de convite que recebeu."
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

const joinSchema = z.object({
  code: z.string().trim().min(1, 'Introduza o código do convite.'),
})

function JoinFamily() {
  const { joinFamily } = useAuth()
  const navigate = useNavigate()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof joinSchema>>({
    resolver: zodResolver(joinSchema),
  })

  async function onSubmit({ code }: z.infer<typeof joinSchema>) {
    setFormError(null)
    try {
      await joinFamily(code)
      navigate(paths.setupHealth)
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  return (
    <AuthScreen
      title="Entrar numa família"
      description="Introduza o código do convite que recebeu."
      backTo={paths.setupFamily}
      progress={{ step: 1, total: SETUP_STEPS.join }}
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-1 flex-col">
        <div className="flex flex-col gap-4">
          <Input
            label="Código do convite"
            icon={Ticket}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="uppercase tracking-widest"
            error={errors.code?.message}
            {...register('code')}
          />
          <FormError message={formError} />
          <DemoHint kind="invitation" onFill={() => setValue('code', demoInvitationCode, { shouldValidate: true })} />
        </div>
        <AuthFooter>
          <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
            Entrar na família
          </Button>
        </AuthFooter>
      </form>
    </AuthScreen>
  )
}
