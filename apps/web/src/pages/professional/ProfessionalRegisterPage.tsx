import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Mail } from 'lucide-react'
import { z } from 'zod'
import { AuthFooter, AuthScreen, AuthSwitch } from '@/components/layout/AuthScreen'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Input, PasswordInput } from '@/components/ui/Input'
import { FormError } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { usePageTitle } from '@/hooks/usePageTitle'
import { errorMessage } from '@/lib/errors'
import { PASSWORD_MIN_LENGTH } from '@/lib/policy'
import { paths } from '@/routes/paths'
import { professionalPortalService } from '@/services/professionalPortal.service'

const schema = z
  .object({
    email: z.email('Introduza um e-mail válido.'),
    password: z.string().min(PASSWORD_MIN_LENGTH, `Use pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`),
    confirmPassword: z.string().min(1, 'Confirme a palavra-passe.'),
    acceptTerms: z.boolean().refine((value) => value, {
      message: 'Aceite os Termos do profissional para continuar.',
    }),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'As palavras-passe não coincidem.',
    path: ['confirmPassword'],
  })
type FormValues = z.infer<typeof schema>

/** Mensagem neutra (UC-MKT-01, BR-MKT-14): não revela se o e-mail já tem conta. */
const NEUTRAL_MESSAGE = 'Se o e-mail for válido, enviámos um código de 6 dígitos.'

/**
 * Registo de profissional (UC-MKT-01, `POST /professional-portal/auth/register`).
 * O e-mail segue para a verificação no estado da navegação, nunca na query string.
 */
export function ProfessionalRegisterPage() {
  usePageTitle('Registo de profissional')
  const navigate = useNavigate()
  const toast = useToast()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', confirmPassword: '', acceptTerms: false },
  })

  async function onSubmit({ email, password }: FormValues) {
    setFormError(null)
    try {
      await professionalPortalService.register({ email, password })
    } catch (error) {
      // Erros técnicos (p.ex. limite de pedidos) são mostrados; a resposta a e-mails existentes é sempre neutra.
      setFormError(errorMessage(error))
      return
    }
    toast.show(NEUTRAL_MESSAGE)
    navigate(paths.professionalVerify, { state: { email } })
  }

  return (
    <AuthScreen
      title="Registo de profissional"
      description="Crie a conta para apresentar os seus serviços na Vita Family."
      backTo={paths.professionalLogin}
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-1 flex-col">
        <div className="flex flex-col gap-4">
          <Input
            label="E-mail profissional"
            type="email"
            icon={Mail}
            placeholder="nome@exemplo.ao"
            autoComplete="email"
            error={errors.email?.message}
            {...register('email')}
          />
          <PasswordInput
            label="Palavra-passe"
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
          <Checkbox
            label="Li e aceito os Termos do profissional."
            error={errors.acceptTerms?.message}
            {...register('acceptTerms')}
          />
          <FormError message={formError} />
        </div>

        <AuthFooter>
          <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
            Criar conta
          </Button>
          <AuthSwitch text="Já tem conta?" to={paths.professionalLogin} label="Entrar" />
        </AuthFooter>
      </form>
    </AuthScreen>
  )
}
