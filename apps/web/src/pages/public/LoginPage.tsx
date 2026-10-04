import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Mail } from 'lucide-react'
import { z } from 'zod'
import { AuthFooter, AuthScreen, AuthSwitch } from '@/components/layout/AuthScreen'
import { DemoHint, demoCredentials } from '@/components/domain/DemoHint'
import { Button } from '@/components/ui/Button'
import { Input, PasswordInput } from '@/components/ui/Input'
import { FormError } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { errorMessage, isAppError } from '@/lib/errors'
import { paths } from '@/routes/paths'

const schema = z.object({
  email: z.email('Introduza um e-mail válido.'),
  password: z.string().min(1, 'Introduza a palavra-passe.'),
})

type FormValues = z.infer<typeof schema>

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
    <AuthScreen title="Entrar" description="Bem-vindo de volta. Aceda à saúde da sua família." backTo={paths.onboarding}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-1 flex-col">
        <div className="flex flex-col gap-4">
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
        </div>

        <AuthFooter>
          <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
            Entrar
          </Button>
          <AuthSwitch text="Ainda não tem conta?" to={paths.register} label="Criar conta" />
        </AuthFooter>
      </form>
    </AuthScreen>
  )
}
