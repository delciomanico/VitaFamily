import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useLocation, useNavigate } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { z } from 'zod'
import { AuthFooter, AuthScreen } from '@/components/layout/AuthScreen'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { OtpInput } from '@/components/ui/OtpInput'
import { FormError } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { usePageTitle } from '@/hooks/usePageTitle'
import { errorMessage } from '@/lib/errors'
import { paths } from '@/routes/paths'
import { professionalPortalService } from '@/services/professionalPortal.service'

const CODE_LENGTH = 6
const RESEND_COOLDOWN_S = 30

const schema = z.object({
  email: z.email('Introduza um e-mail válido.'),
  code: z.string().regex(/^\d{6}$/, 'Introduza o código de 6 dígitos.'),
})
type FormValues = z.infer<typeof schema>

/** Lê o e-mail do estado da navegação (nunca da query string). */
function emailFromState(state: unknown): string | null {
  if (typeof state === 'object' && state !== null && 'email' in state && typeof state.email === 'string') {
    return state.email
  }
  return null
}

/** UC-MKT-01: verificação do e-mail do profissional por código de 6 dígitos. */
export function ProfessionalVerifyPage() {
  usePageTitle('Verificar e-mail')
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const stateEmail = emailFromState(location.state)
  const [formError, setFormError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S)
  const {
    register,
    control,
    getValues,
    trigger,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: stateEmail ?? '', code: '' },
  })

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  async function onSubmit({ email, code }: FormValues) {
    setFormError(null)
    try {
      await professionalPortalService.verifyEmail(stateEmail ?? email, code)
    } catch (error) {
      setFormError(errorMessage(error))
      return
    }
    toast.show('E-mail verificado. Já pode entrar.')
    navigate(paths.professionalLogin)
  }

  async function onResend() {
    setFormError(null)
    const address = stateEmail ?? getValues('email')
    if (!address || !(await trigger('email'))) {
      setFormError('Introduza o e-mail da conta para reenviar o código.')
      return
    }
    try {
      await professionalPortalService.resendVerification(address)
      setCooldown(RESEND_COOLDOWN_S)
      toast.show('Enviámos um novo código.')
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    }
  }

  return (
    <AuthScreen
      title="Digite o código enviado"
      description={
        stateEmail ? (
          <>
            Enviámos um código de {CODE_LENGTH} dígitos para{' '}
            <span className="font-medium text-foreground">{stateEmail}</span>.
          </>
        ) : (
          `Introduza o e-mail da conta e o código de ${CODE_LENGTH} dígitos que enviámos.`
        )
      }
      backTo={paths.professionalRegister}
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-1 flex-col">
        <div className="flex flex-col gap-5">
          {!stateEmail && (
            <Input
              label="E-mail"
              type="email"
              icon={Mail}
              placeholder="nome@exemplo.ao"
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
                  label="Código de verificação"
                  value={field.value}
                  onChange={field.onChange}
                  length={CODE_LENGTH}
                  error={Boolean(errors.code) || Boolean(formError)}
                  disabled={isSubmitting}
                />
                {errors.code && <p className="text-sm text-danger">{errors.code.message}</p>}
              </div>
            )}
          />
          <FormError message={formError} />
          <div className="flex flex-col items-center gap-1 text-sm">
            {cooldown > 0 ? (
              <p className="text-muted">
                Pode reenviar o código em <span className="font-semibold text-primary tabular-nums">{cooldown}</span>{' '}
                segundos
              </p>
            ) : (
              <p className="text-muted">Não recebeu o código?</p>
            )}
            <button
              type="button"
              onClick={onResend}
              disabled={cooldown > 0}
              className="h-9 px-3 font-semibold text-primary hover:underline disabled:pointer-events-none disabled:text-muted"
            >
              Reenviar código
            </button>
          </div>
        </div>

        <AuthFooter>
          <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
            Verificar
          </Button>
        </AuthFooter>
      </form>
    </AuthScreen>
  )
}
