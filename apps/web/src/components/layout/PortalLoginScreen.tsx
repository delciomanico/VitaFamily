import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, Mail, type LucideIcon } from 'lucide-react'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { HeroMedia } from '@/components/ui/HeroMedia'
import { Input, PasswordInput } from '@/components/ui/Input'
import { FormError } from '@/components/ui/states'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { paths } from '@/routes/paths'
import { Logo } from './Logo'

const schema = z.object({
  email: z.email('Introduza um e-mail válido.'),
  password: z.string().min(1, 'Introduza a palavra-passe.'),
})
type FormValues = z.infer<typeof schema>

interface PortalLoginScreenProps {
  /** Etiqueta do portal («Portal da clínica»). */
  badge: string
  badgeIcon: LucideIcon
  /** Título do cartão (h1). */
  title: string
  /** Fotografias do fundo; sem elas, fundo escuro (backoffice). */
  images?: string[]
  emailLabel?: string
  emailPlaceholder?: string
  submitLabel?: string
  /** Ligação única por baixo do formulário (ex.: «Solicitar acesso»). */
  footerLink?: { prefix?: string; label: string; to: string }
  login: (email: string, password: string) => Promise<void>
  /** Substitui o formulário (ex.: aviso de conta sem acesso). */
  notice?: ReactNode
}

/**
 * Login dos portais: cartão branco ao centro sobre fotografia em carrossel (ou fundo escuro, no
 * backoffice). Uma só coluna, só o essencial. O redirecionamento depois de entrar é feito pelo guard
 * de cada portal.
 */
export function PortalLoginScreen({
  badge,
  badgeIcon: BadgeIcon,
  title,
  images,
  emailLabel = 'E-mail',
  emailPlaceholder = 'nome@exemplo.com',
  submitLabel = 'Entrar',
  footerLink,
  login,
  notice,
}: PortalLoginScreenProps) {
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
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden text-foreground">
      {images ? (
        <>
          <HeroMedia images={images.map((src) => ({ src }))} />
          <div aria-hidden className="absolute inset-0 -z-10 bg-black/50" />
        </>
      ) : (
        <div aria-hidden className="absolute inset-0 -z-10 bg-foreground">
          <div className="absolute -top-32 -left-24 size-[32rem] animate-drift rounded-full bg-primary/50 blur-3xl" />
          <div className="absolute -right-32 -bottom-32 size-[30rem] animate-drift rounded-full bg-accent/30 blur-3xl [animation-delay:-8s]" />
        </div>
      )}

      <header className="flex items-center justify-between px-5 pt-[max(1.25rem,env(safe-area-inset-top))] lg:px-10">
        <Link to={paths.splash} aria-label="Vita Family, página inicial" className="rounded-full bg-surface px-4 py-2">
          <Logo />
        </Link>
        <Link
          to={paths.enter}
          className="inline-flex h-11 items-center gap-2 rounded-full px-4 text-base font-medium text-white hover:bg-white/15"
        >
          <ArrowLeft className="size-5" aria-hidden />
          Escolher portal
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-md animate-rise rounded-[2rem] bg-surface p-8 shadow-overlay md:p-10">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <BadgeIcon className="size-7" aria-hidden />
          </span>
          <p className="mt-6 text-base font-semibold tracking-wide text-primary uppercase">{badge}</p>
          <h1 className="mt-2 text-3xl leading-tight font-bold tracking-tight text-balance md:text-4xl">{title}</h1>

          {notice ?? (
            <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-8 flex flex-col gap-5">
              <Input
                label={emailLabel}
                type="email"
                icon={Mail}
                placeholder={emailPlaceholder}
                autoComplete="email"
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
                {submitLabel}
              </Button>
              {footerLink && (
                <p className={cn('text-center text-base text-muted')}>
                  {footerLink.prefix}{' '}
                  <Link to={footerLink.to} className="font-semibold text-primary hover:underline">
                    {footerLink.label}
                  </Link>
                </p>
              )}
            </form>
          )}
        </div>
      </main>
    </div>
  )
}
