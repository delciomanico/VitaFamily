import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Logo } from '@/components/layout/Logo'
import { DemoHint, demoCredentials } from '@/components/domain/DemoHint'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
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
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-6">
        <Logo />
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Entrar</h1>
          <p className="text-muted">Bem-vindo de volta.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        <Input label="E-mail" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <Input
          label="Palavra-passe"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <Link to={paths.forgotPassword} className="w-fit text-sm font-medium text-primary hover:underline">
          Esqueci a palavra-passe
        </Link>
        <FormError message={formError} />
        <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
          Entrar
        </Button>
      </form>

      <DemoHint kind="login" onFill={fillDemo} />

      <p className="text-center text-sm text-muted">
        Ainda não tem conta?{' '}
        <Link to={paths.register} className="font-medium text-primary hover:underline">
          Criar conta
        </Link>
      </p>
    </div>
  )
}
