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
import { LoginBackground } from '@/pages/public/LoginBackground'
import { Logo, LogoMark } from './Logo'

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
  /** Ligação opcional por cima do botão (ex.: «Esqueci-me da palavra-passe»). */
  forgotLink?: { label: string; to: string }
  login: (email: string, password: string) => Promise<void>
  /** Substitui o formulário (ex.: aviso de conta sem acesso). */
  notice?: ReactNode
}

/**
 * Login dos portais. Desktop: um único contentor retangular centrado, com o formulário à esquerda e a
 * fotografia em carrossel à direita (fundo escuro no backoffice). Telemóvel: igual ao login da app,
 * com fotografias desfocadas, logótipo no topo e folha branca com o formulário. O redirecionamento depois de entrar é feito pelo guard
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
  forgotLink,
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
    <div className="relative flex min-h-dvh flex-col lg:grid lg:place-items-center lg:bg-background lg:p-10">
      {/* Telemóvel: fundo de fotografias e logótipo no topo, como no login da app. */}
      <div className="lg:hidden">
        {images ? (
          <LoginBackground />
        ) : (
          <div aria-hidden className="absolute inset-0 overflow-hidden bg-foreground">
            <div className="absolute -top-32 -left-24 size-[28rem] animate-drift rounded-full bg-primary/60 blur-3xl" />
            <div className="absolute -right-24 -bottom-24 size-[24rem] animate-drift rounded-full bg-accent/40 blur-3xl [animation-delay:-8s]" />
          </div>
        )}
        <Link
          to={paths.enter}
          aria-label="Escolher portal"
          className="absolute top-[max(0.5rem,env(safe-area-inset-top))] left-2.5 z-10 flex size-11 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
      </div>
      <div className="relative flex min-h-32 flex-1 flex-col items-center justify-center gap-3 px-6 pt-safe text-white lg:hidden">
        <LogoMark tone="inverse" className="size-14 drop-shadow-lg" />
        <p className="text-[1.375rem] font-bold tracking-tight drop-shadow">Vita Family</p>
        <span className="flex items-center gap-2 rounded-full bg-white/20 px-4 py-1.5 text-sm font-semibold backdrop-blur">
          <BadgeIcon className="size-4" aria-hidden />
          {badge}
        </span>
      </div>

      {/* Telemóvel: folha branca encostada ao fundo. Desktop: um único contentor retangular centrado. */}
      <div className="relative rounded-t-3xl bg-surface shadow-overlay lg:grid lg:w-full lg:max-w-5xl lg:animate-rise lg:grid-cols-2 lg:overflow-hidden lg:rounded-md lg:border lg:border-border lg:shadow-overlay lg:min-h-[38rem]">
        <div className="flex flex-col px-5 pt-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] lg:px-12 lg:pt-8 lg:pb-12">
          <header className="hidden items-center justify-between lg:flex">
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

          <main className="flex flex-col lg:flex-1 lg:justify-center lg:py-10">
            <span className="hidden size-12 items-center justify-center rounded-md bg-primary-soft text-primary lg:flex">
              <BadgeIcon className="size-7" aria-hidden />
            </span>
            <p className="mt-5 hidden text-sm font-semibold tracking-wide text-primary uppercase lg:block">{badge}</p>
            <h1 className="text-[1.375rem] leading-tight font-bold tracking-tight text-balance lg:mt-2 lg:text-4xl lg:leading-[1.15]">
              {title}
            </h1>

            {notice ?? (
              <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-5 flex flex-col gap-4 lg:mt-8 lg:gap-5">
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
                {forgotLink && (
                  <Link to={forgotLink.to} className="-mt-2 self-end text-sm font-semibold text-primary hover:underline">
                    {forgotLink.label}
                  </Link>
                )}
                <FormError message={formError} />
                <Button type="submit" size="lg" fullWidth loading={isSubmitting} className="lg:h-14 lg:rounded-md! lg:text-base">
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

        {/* Desktop: imagem encostada ao contentor, sem texto por cima (fundo escuro no backoffice). */}
        <aside aria-hidden className="relative isolate hidden overflow-hidden bg-foreground lg:block">
          {images ? (
            <HeroMedia images={images.map((src) => ({ src }))} />
          ) : (
            <div className="absolute inset-0">
              <div className="absolute -top-24 -left-24 size-[32rem] animate-drift rounded-full bg-primary/60 blur-3xl" />
              <div className="absolute -right-24 -bottom-24 size-[30rem] animate-drift rounded-full bg-accent/40 blur-3xl [animation-delay:-8s]" />
              <LockKeyhole className="absolute top-1/2 left-1/2 size-24 -translate-x-1/2 -translate-y-1/2 text-white/30" strokeWidth={1.25} />
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
