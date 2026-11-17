import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useLocation, useNavigate } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { z } from 'zod'
import { AuthFooter, AuthScreen } from '@/components/layout/AuthScreen'
import { Button } from '@/components/ui/Button'
import { Input, PasswordInput } from '@/components/ui/Input'
import { OtpInput } from '@/components/ui/OtpInput'
import { FormError } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { usePageTitle } from '@/hooks/usePageTitle'
import { errorMessage } from '@/lib/errors'
import { PASSWORD_MIN_LENGTH } from '@/lib/policy'
import { paths } from '@/routes/paths'
import { professionalPortalService } from '@/services/professionalPortal.service'

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

/** Lê o e-mail do estado da navegação (nunca da query string). */
function emailFromState(state: unknown): string | null {
  if (typeof state === 'object' && state !== null && 'email' in state && typeof state.email === 'string') {
    return state.email
  }
  return null
}

/** UC-MKT-02: redefinição da palavra-passe com código de 6 dígitos enviado por e-mail. */
export function ProfessionalResetPage() {
  usePageTitle('Repor palavra-passe')
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const stateEmail = emailFromState(location.state)
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: stateEmail ?? '', code: '', password: '', confirmPassword: '' },
  })

  async function onSubmit({ email, code, password }: FormValues) {
    setFormError(null)
    try {
      await professionalPortalService.resetPassword(stateEmail ?? email, code, password)
    } catch (error) {
      setFormError(errorMessage(error))
      return
    }
    toast.show('Palavra-passe alterada. Entre com a nova palavra-passe.')
    navigate(paths.professionalLogin)
  }

  return (
    <AuthScreen
      title="Confirmar código"
      description={
        stateEmail
          ? `Introduza o código de ${CODE_LENGTH} dígitos enviado para o seu e-mail e defina a nova palavra-passe.`
          : `Introduza o e-mail da conta, o código de ${CODE_LENGTH} dígitos enviado para o seu e-mail e defina a nova palavra-passe.`
      }
      backTo={paths.professionalForgot}
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-1 flex-col">
        <div className="flex flex-col gap-4">
          {!stateEmail && (
            <Input
              label="E-mail"
              type="email"
              icon={Mail}
              autoComplete="email"
              error={errors.email?.message}
              {...register('email')}
            />
          )}
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
