import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Mail, Stethoscope } from 'lucide-react'
import { z } from 'zod'
import { LogoMark } from '@/components/layout/Logo'
import { Button } from '@/components/ui/Button'
import { Input, PasswordInput } from '@/components/ui/Input'
import { FormError } from '@/components/ui/states'
import { useClinicAuth } from '@/contexts/ClinicAuthContext'
import { errorMessage } from '@/lib/errors'
import { paths } from '@/routes/paths'

const schema = z.object({
  email: z.email('Introduza um e-mail válido.'),
  password: z.string().min(1, 'Introduza a palavra-passe.'),
})

type FormValues = z.infer<typeof schema>

/**
 * Login do **portal da clínica** (`POST /clinic-portal/auth/login`, D18/ADR-020), em rota própria
 * (`/clinic/login`) e fora do fluxo de login da app de família: são contas (`ClinicAccount`) de um
 * espaço de identidade separado, sem relação com as contas de utilizador nem com famílias.
 * O redirecionamento após entrar é feito pelo guard `ClinicGuestOnly`.
 */
export function ClinicLoginPage() {
  const { login } = useClinicAuth()
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
      setFormError(errorMessage(error))
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-surface-muted px-5 py-10">
      <div className="flex w-full max-w-md flex-col gap-6 rounded-3xl bg-surface px-6 py-8 shadow-overlay md:px-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <LogoMark className="size-12" />
          <span className="flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-sm font-semibold text-primary">
            <Stethoscope className="size-4" aria-hidden />
            Portal da clínica
          </span>
          <h1 className="text-[1.625rem] leading-tight font-bold tracking-tight">Entrar na área da clínica</h1>
          <p className="text-muted">
            Esta é a área das clínicas parceiras: pedidos de consulta, agenda e horários. É uma conta diferente da conta
            da aplicação Vita Family.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          <Input
            label="E-mail da conta da clínica"
            type="email"
            icon={Mail}
            placeholder="nome@clinica.pt"
            autoComplete="email"
            error={errors.email?.message}
            {...register('email')}
          />
          <PasswordInput
            label="Palavra-passe"
            placeholder="A palavra-passe da conta da clínica"
            autoComplete="current-password"
            error={errors.password?.message}
            {...register('password')}
          />
          <FormError message={formError} />
          <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
            Entrar
          </Button>
          <p className="text-center text-sm text-muted">
            Perdeu o acesso de Admin da clínica? Contacte a equipa Vita Family — só ela repõe essa conta.
          </p>
          <p className="text-center text-sm text-muted">
            É utilizador da aplicação?{' '}
            <Link to={paths.login} className="font-semibold text-primary hover:underline">
              Entrar na Vita Family
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
