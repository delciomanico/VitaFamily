import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Mail, MailCheck } from 'lucide-react'
import { z } from 'zod'
import { AuthFooter, AuthScreen } from '@/components/layout/AuthScreen'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { FormError } from '@/components/ui/states'
import { errorMessage } from '@/lib/errors'
import { paths } from '@/routes/paths'
import { authService } from '@/services/auth.service'

const schema = z.object({ email: z.email('Introduza um e-mail válido.') })
type FormValues = z.infer<typeof schema>

/** UC-ACC-03: a resposta é igual exista ou não a conta. Nenhum e-mail é enviado (mock). */
export function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  async function onSubmit({ email }: FormValues) {
    setFormError(null)
    try {
      await authService.requestPasswordReset(email)
      setSentTo(email)
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  if (sentTo) {
    return (
      <AuthScreen title="Verifique o seu e-mail" backTo={paths.login}>
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <span className="flex size-24 items-center justify-center rounded-full bg-primary-soft text-primary">
            <MailCheck className="size-11" strokeWidth={1.75} aria-hidden />
          </span>
          <p className="text-muted">
            Se existir uma conta associada a <span className="font-medium text-foreground">{sentTo}</span>, enviámos
            as instruções para redefinir a palavra-passe.
          </p>
        </div>
        <AuthFooter>
          <ButtonLink to={paths.login} size="lg" fullWidth>
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
      description="Indique o e-mail da sua conta e enviaremos as instruções para criar uma nova palavra-passe."
      backTo={paths.login}
    >
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
