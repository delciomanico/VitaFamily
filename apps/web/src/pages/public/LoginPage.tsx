import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, Mail } from 'lucide-react'
import { z } from 'zod'
import { AuthSwitch } from '@/components/layout/AuthScreen'
import { LogoMark } from '@/components/layout/Logo'
import { DemoHint, demoCredentials } from '@/components/domain/DemoHint'
import { Button } from '@/components/ui/Button'
import { Input, PasswordInput } from '@/components/ui/Input'
import { FormError } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { errorMessage, isAppError } from '@/lib/errors'
import { paths } from '@/routes/paths'
import { LoginBackground } from './LoginBackground'

const schema = z.object({
  email: z.email('Introduza um e-mail válido.'),
  password: z.string().min(1, 'Introduza a palavra-passe.'),
})

type FormValues = z.infer<typeof schema>

/**
 * Login: fotos desfocadas em fundo (slides com fade) e o formulário numa folha branca —
 * encostada ao fundo no mobile, cartão centrado no desktop.
 */
export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  // O redirecionamento após o login é feito pelo guard GuestOnly.
  async function onSubmit({ email, password }: FormValues) {
    setFormError(null)
    try {
      await login(email, password)
    } catch (error) {
      if (isAppError(error, 'EMAIL_NOT_VERIFIED')) navigate(paths.verify)
      else setFormError(errorMessage(error))
    }
  }

  function fillDemo() {
    setValue('email', demoCredentials.email, { shouldValidate: true })
    setValue('password', demoCredentials.password, { shouldValidate: true })
  }

  return (
    <div className="relative flex min-h-dvh flex-col md:items-center md:justify-center md:py-10">
      <LoginBackground />

      <Link
        to={paths.onboarding}
        aria-label="Voltar"
        className="absolute top-[max(0.5rem,env(safe-area-inset-top))] left-2.5 z-10 flex size-11 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15"
      >
        <ArrowLeft className="size-5" aria-hidden />
      </Link>

      <div className="relative flex min-h-32 flex-1 flex-col items-center justify-center gap-3 px-6 pt-safe text-white md:flex-none md:pb-8">
        <LogoMark tone="inverse" className="size-16 drop-shadow-lg" />
        <p className="text-[1.625rem] font-bold tracking-tight drop-shadow">Vita Family</p>
      </div>

      <div className="relative rounded-t-3xl bg-surface px-5 pt-7 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-overlay md:w-full md:max-w-md md:rounded-3xl md:px-8 md:py-8">
        <div className="flex flex-col gap-1 pb-5">
          <h1 className="text-[1.625rem] leading-tight font-bold tracking-tight">Entrar</h1>
          <p className="text-muted">Bem-vindo de volta.</p>
        </div>

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
          <Link to={paths.forgotPassword} className="-mt-1 self-end text-sm font-semibold text-primary hover:underline">
            Esqueceu a palavra-passe?
          </Link>
          <FormError message={formError} />
          <DemoHint kind="login" onFill={fillDemo} />
          <Button type="submit" size="lg" fullWidth loading={isSubmitting} className="mt-1">
            Entrar
          </Button>
          <AuthSwitch text="Ainda não tem conta?" to={paths.register} label="Criar conta" />
        </form>
      </div>
    </div>
  )
}
