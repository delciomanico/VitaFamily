import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Input } from '@/components/ui/Input'
import { FormError } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { todayISO } from '@/lib/date'
import { errorMessage } from '@/lib/errors'
import { PASSWORD_MIN_LENGTH } from '@/lib/policy'
import { paths } from '@/routes/paths'
import { TERMS_VERSION } from '@/services/auth.service'
import { registerSchema, type RegisterFormValues } from './register.schema'

export function RegisterPage() {
  const { register: createAccount } = useAuth()
  const navigate = useNavigate()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { acceptTerms: false },
  })

  async function onSubmit({ name, email, birthDate, password }: RegisterFormValues) {
    setFormError(null)
    try {
      await createAccount({
        name,
        email,
        birthDate,
        password,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        termsVersion: TERMS_VERSION,
      })
      navigate(paths.verify)
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Criar conta" description="Comece a organizar a saúde da sua família." backTo={paths.login} />

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        <Input label="Nome" autoComplete="name" error={errors.name?.message} {...register('name')} />
        <Input label="E-mail" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <Input
          label="Data de nascimento"
          type="date"
          max={todayISO()}
          autoComplete="bday"
          error={errors.birthDate?.message}
          {...register('birthDate')}
        />
        <Input
          label="Palavra-passe"
          type="password"
          autoComplete="new-password"
          hint={`Pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`}
          error={errors.password?.message}
          {...register('password')}
        />
        <Input
          label="Confirmar palavra-passe"
          type="password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        {/* TODO(fase 12): ligar às páginas de Termos e Política de privacidade. */}
        <Checkbox
          label="Li e aceito os Termos de utilização e a Política de privacidade."
          error={errors.acceptTerms?.message}
          {...register('acceptTerms')}
        />
        <FormError message={formError} />
        <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
          Criar conta
        </Button>
      </form>

      <p className="text-center text-sm text-muted">
        Já tem conta?{' '}
        <Link to={paths.login} className="font-medium text-primary hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  )
}
