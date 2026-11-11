import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Mail } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import { AuthFooter, AuthScreen } from '@/components/layout/AuthScreen'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Input, PasswordInput } from '@/components/ui/Input'
import { OtpInput } from '@/components/ui/OtpInput'
import { FormError } from '@/components/ui/states'
import { errorMessage } from '@/lib/errors'
import { PASSWORD_MIN_LENGTH } from '@/lib/policy'
import { paths } from '@/routes/paths'
import { authService } from '@/services/auth.service'

const CODE_LENGTH = 6

const schema = z
  .object({
    email: z.email('Introduza um e-mail válido.'),
    code: z.string().regex(/^\d{6}$/, 'Introduza o código de 6 dígitos.'),
    password: z.string().min(PASSWORD_MIN_LENGTH, `Use pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`),
    confirmPassword: z.string().min(1, 'Confirme a palavra-passe.'),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'As palavras-passe não coincidem.',
    path: ['confirmPassword'],
  })
type FormValues = z.infer<typeof schema>

/**
 * UC-ACC-03 (continuação): página de confirmação da recuperação. O código OTP de 6 dígitos
 * enviado por e-mail é validado em conjunto com o e-mail (vem pré-preenchido a partir do pedido).
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const [done, setDone] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: params.get('email') ?? '', code: '' },
  })

  async function onSubmit({ email, code, password }: FormValues) {
    setFormError(null)
    try {
      await authService.resetPassword(email, code, password)
      setDone(true)
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  if (done) {
    return (
      <AuthScreen title="Palavra-passe alterada" backTo={paths.login}>
        <p className="text-muted">Já pode iniciar sessão com a nova palavra-passe.</p>
        <AuthFooter>
          <ButtonLink to={paths.login} size="lg" fullWidth>
            Ir para o login
          </ButtonLink>
        </AuthFooter>
      </AuthScreen>
    )
  }

  return (
    <AuthScreen
      title="Confirmar código"
      description="Introduza o código de 6 dígitos enviado para o seu e-mail e defina a nova palavra-passe."
      backTo={paths.forgotPassword}
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-1 flex-col">
        <div className="flex flex-col gap-4">
          <Input
            label="E-mail"
            type="email"
            icon={Mail}
            autoComplete="email"
            error={errors.email?.message}
            {...register('email')}
          />
          <Controller
            control={control}
            name="code"
            render={({ field }) => (
              <div className="flex flex-col gap-1">
                <OtpInput
                  label="Código de recuperação"
                  value={field.value}
                  onChange={field.onChange}
                  length={CODE_LENGTH}
                  error={Boolean(errors.code)}
                  disabled={isSubmitting}
                />
                {errors.code && <p className="text-sm text-danger">{errors.code.message}</p>}
              </div>
            )}
          />
          <PasswordInput
            label="Nova palavra-passe"
            autoComplete="new-password"
            hint={`Pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`}
            error={errors.password?.message}
            {...register('password')}
          />
          <PasswordInput
            label="Confirmar palavra-passe"
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            {...register('confirmPassword')}
          />
          <FormError message={formError} />
        </div>
        <AuthFooter>
          <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
            Guardar palavra-passe
          </Button>
        </AuthFooter>
      </form>
    </AuthScreen>
  )
}
