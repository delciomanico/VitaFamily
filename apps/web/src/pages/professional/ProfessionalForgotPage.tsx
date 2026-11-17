import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Mail, MailCheck } from 'lucide-react'
import { z } from 'zod'
import { AuthFooter, AuthScreen } from '@/components/layout/AuthScreen'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { FormError } from '@/components/ui/states'
import { usePageTitle } from '@/hooks/usePageTitle'
import { errorMessage } from '@/lib/errors'
import { paths } from '@/routes/paths'
import { professionalPortalService } from '@/services/professionalPortal.service'

const schema = z.object({ email: z.email('Introduza um e-mail válido.') })
type FormValues = z.infer<typeof schema>

/**
 * Recuperação da palavra-passe do portal do profissional (UC-MKT-02).
 * A resposta é igual exista ou não a conta; o e-mail segue para a página de redefinição no estado da navegação.
 */
export function ProfessionalForgotPage() {
  usePageTitle('Recuperar palavra-passe')
  const navigate = useNavigate()
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '' } })

  async function onSubmit({ email }: FormValues) {
    setFormError(null)
    try {
      await professionalPortalService.forgotPassword(email)
      setSentTo(email)
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  if (sentTo) {
    return (
      <AuthScreen title="Verifique o seu e-mail" backTo={paths.professionalLogin}>
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <span className="flex size-24 items-center justify-center rounded-full bg-primary-soft text-primary">
            <MailCheck className="size-11" strokeWidth={1.75} aria-hidden />
          </span>
          <p className="text-muted">
            Se existir uma conta de profissional associada a <span className="font-medium text-foreground">{sentTo}</span>,
            enviámos um código de 6 dígitos para redefinir a palavra-passe.
          </p>
        </div>
        <AuthFooter>
          <Button
            size="lg"
            fullWidth
            onClick={() => navigate(paths.professionalReset, { state: { email: sentTo } })}
          >
            Já tenho o código
          </Button>
          <ButtonLink to={paths.professionalLogin} variant="soft" size="lg" fullWidth>
            Voltar ao login
          </ButtonLink>
          <Button variant="soft" size="lg" fullWidth onClick={() => setSentTo(null)}>
            Usar outro e-mail
          </Button>
        </AuthFooter>
      </AuthScreen>
    )
  }

  return (
    <AuthScreen
      title="Recuperar palavra-passe"
      description="Indique o e-mail da sua conta de profissional e enviaremos as instruções para criar uma nova palavra-passe."
      backTo={paths.professionalLogin}
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-1 flex-col">
        <div className="flex flex-col gap-4">
          <Input
            label="E-mail"
            type="email"
            icon={Mail}
            placeholder="nome@exemplo.ao"
            autoComplete="email"
            error={errors.email?.message}
            {...register('email')}
          />
          <FormError message={formError} />
        </div>
        <AuthFooter>
          <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
            Enviar instruções
          </Button>
        </AuthFooter>
      </form>
    </AuthScreen>
  )
}
