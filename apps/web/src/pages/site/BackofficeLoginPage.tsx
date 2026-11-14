import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { LockKeyhole, Mail } from 'lucide-react'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { Input, PasswordInput } from '@/components/ui/Input'
import { FormError } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { usePageTitle } from '@/hooks/usePageTitle'
import { errorMessage } from '@/lib/errors'
import { paths } from '@/routes/paths'

const schema = z.object({
  email: z.email('Introduza um e-mail válido.'),
  password: z.string().min(1, 'Introduza a palavra-passe.'),
})
type FormValues = z.infer<typeof schema>

/**
 * Entrada do backoffice (Platform Admin). Usa a mesma sessão de `User` da app, mas só deixa seguir
 * contas com o papel de administrador da plataforma; qualquer outra sessão é recusada aqui, sem
 * ser enviada para a app de família.
 */
export function BackofficeLoginPage() {
  usePageTitle('Backoffice')
  const { user, login, logout } = useAuth()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  if (user?.platformRole === 'PLATFORM_ADMIN') return <Navigate to={paths.admin} replace />

  async function onSubmit({ email, password }: FormValues) {
    setFormError(null)
    try {
      await login(email, password)
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  return (
    <section className="relative overflow-hidden bg-surface">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -left-24 size-[30rem] animate-drift rounded-full bg-primary-soft blur-3xl" />
      </div>
      <div className="relative mx-auto max-w-xl animate-rise px-5 py-20 lg:py-28">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-foreground text-white">
          <LockKeyhole className="size-8" aria-hidden />
        </span>
        <h1 className="mt-5 text-4xl leading-tight font-bold tracking-tight md:text-5xl">Backoffice</h1>
        <p className="mt-3 text-lg text-muted">Acesso interno da equipa Vita Family.</p>

        {user ? (
          <div role="alert" className="mt-10 flex flex-col gap-4 rounded-3xl bg-warning-soft p-6">
            <p className="text-lg font-semibold">Esta conta não tem acesso ao backoffice.</p>
            <p className="text-base">Tem a sessão iniciada como {user.email}. Termine-a e entre com uma conta de administrador da plataforma.</p>
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" size="lg" onClick={() => logout()}>
                Terminar sessão
              </Button>
              <Link to={paths.home} className="inline-flex h-12 items-center px-4 font-semibold text-primary hover:underline">
                Ir para a minha área
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-10 flex flex-col gap-5">
            <Input
              label="E-mail"
              type="email"
              icon={Mail}
              autoComplete="email"
              placeholder="nome@exemplo.com"
              error={errors.email?.message}
              {...register('email')}
            />
            <PasswordInput
              label="Palavra-passe"
              autoComplete="current-password"
              error={errors.password?.message}
              {...register('password')}
            />
            <FormError message={formError} />
            <Button type="submit" size="lg" fullWidth loading={isSubmitting} className="h-14 text-base">
              Entrar no backoffice
            </Button>
            <Link to={paths.forgotPassword} className="text-center text-base font-semibold text-primary hover:underline">
              Esqueceu a palavra-passe?
            </Link>
          </form>
        )}
      </div>
    </section>
  )
}
