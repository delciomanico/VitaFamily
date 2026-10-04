import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { MailCheck } from 'lucide-react'
import { z } from 'zod'
import { PageHeader } from '@/components/layout/PageHeader'
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
      <div className="flex flex-col items-center gap-6 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-primary-soft text-primary">
          <MailCheck className="size-8" aria-hidden />
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Verifique o seu e-mail</h1>
          <p className="text-muted">
            Se existir uma conta associada a <span className="font-medium text-foreground">{sentTo}</span>, enviámos
            as instruções para redefinir a palavra-passe.
          </p>
        </div>
        <ButtonLink to={paths.login} size="lg" fullWidth>
          Voltar ao login
        </ButtonLink>
        <Button variant="ghost" onClick={() => setSentTo(null)}>
          Usar outro e-mail
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Recuperar palavra-passe"
        description="Indique o e-mail da sua conta e enviaremos as instruções."
        backTo={paths.login}
      />
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        <Input label="E-mail" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <FormError message={formError} />
        <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
          Enviar
        </Button>
      </form>
    </div>
  )
}
