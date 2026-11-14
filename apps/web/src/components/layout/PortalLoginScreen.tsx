import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, LockKeyhole, Mail, type LucideIcon } from 'lucide-react'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { HeroMedia } from '@/components/ui/HeroMedia'
import { Input, PasswordInput } from '@/components/ui/Input'
import { FormError } from '@/components/ui/states'
import { errorMessage } from '@/lib/errors'
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
 * Login dos portais: formulário simples à esquerda e fotografia em carrossel numa moldura
 * arredondada à direita (fundo escuro no backoffice); em ecrãs pequenos, só o formulário. O redirecionamento depois de entrar é feito pelo guard
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
    <div className="grid min-h-dvh bg-surface lg:grid-cols-2">
      <div className="flex flex-col px-6 pt-[max(1.25rem,env(safe-area-inset-top))] pb-8 lg:px-14">
        <header className="flex items-center justify-between">
          <Link to={paths.splash} aria-label="Vita Family, página inicial">
            <Logo />
          </Link>
          <Link
            to={paths.enter}
            className="-mr-3 inline-flex h-11 items-center gap-2 rounded-full px-3 text-base font-medium text-muted hover:bg-surface-muted hover:text-foreground"
          >
            <ArrowLeft className="size-5" aria-hidden />
            Escolher portal
          </Link>
        </header>

        <main className="mx-auto flex w-full max-w-md flex-1 animate-rise flex-col justify-center py-12">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <BadgeIcon className="size-7" aria-hidden />
          </span>
          <p className="mt-6 text-base font-semibold tracking-wide text-primary uppercase">{badge}</p>
          <h1 className="mt-2 text-4xl leading-[1.1] font-bold tracking-tight text-balance md:text-5xl">{title}</h1>

          {notice ?? (
            <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-10 flex flex-col gap-5">
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
                <p className="text-center text-base text-muted">
                  {footerLink.prefix}{' '}
                  <Link to={footerLink.to} className="font-semibold text-primary hover:underline">
                    {footerLink.label}
                  </Link>
                </p>
              )}
            </form>
          )}
        </main>
      </div>

      {/* Imagem à direita, em moldura arredondada; sem texto por cima. */}
      <aside aria-hidden className="hidden p-4 lg:block">
        <div className="relative isolate h-full overflow-hidden rounded-[2rem] bg-foreground">
          {images ? (
            <HeroMedia images={images.map((src) => ({ src }))} />
          ) : (
            <div className="absolute inset-0">
              <div className="absolute -top-24 -left-24 size-[32rem] animate-drift rounded-full bg-primary/60 blur-3xl" />
              <div className="absolute -right-24 -bottom-24 size-[30rem] animate-drift rounded-full bg-accent/40 blur-3xl [animation-delay:-8s]" />
              <LockKeyhole className="absolute top-1/2 left-1/2 size-24 -translate-x-1/2 -translate-y-1/2 text-white/30" strokeWidth={1.25} />
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
