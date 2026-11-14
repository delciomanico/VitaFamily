import { useState } from 'react'
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
  /** Título do formulário (h1). */
  title: string
  /** Frase grande sobre a fotografia. */
  tagline: string
  images: string[]
  emailLabel: string
  emailPlaceholder: string
  passwordPlaceholder: string
  requestAccessTo: string
  login: (email: string, password: string) => Promise<void>
}

/**
 * Ecrã de login dos portais (clínica e seguradora), com o desenho do site público: fotografia em
 * carrossel e frase à esquerda (só em ecrãs largos) e formulário à direita. O redirecionamento
 * depois de entrar é feito pelo guard de cada portal.
 */
export function PortalLoginScreen({
  badge,
  badgeIcon: BadgeIcon,
  title,
  tagline,
  images,
  emailLabel,
  emailPlaceholder,
  passwordPlaceholder,
  requestAccessTo,
  login,
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
    <div className="grid min-h-dvh bg-surface lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative isolate hidden overflow-hidden text-white lg:flex">
        <HeroMedia images={images.map((src) => ({ src }))} />
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-black/80 via-black/40 to-black/25" />
        <div className="relative flex w-full animate-rise flex-col justify-between p-12 xl:p-16">
          <Link to={paths.splash} aria-label="Vita Family, página inicial" className="self-start rounded-full bg-surface px-4 py-2 text-foreground">
            <Logo />
          </Link>
          <p className="max-w-xl text-5xl leading-[1.1] font-bold tracking-tight text-balance xl:text-6xl">{tagline}</p>
        </div>
      </aside>

      <main className="relative flex flex-col overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -top-32 -right-24 size-[28rem] animate-drift rounded-full bg-primary-soft blur-3xl" />
        </div>
        <div className="relative flex items-center justify-between px-6 pt-6 pt-safe lg:px-12">
          <Link to={paths.enter} className="inline-flex h-11 items-center gap-2 rounded-full px-3 text-base font-medium text-muted hover:bg-surface-muted hover:text-foreground">
            <ArrowLeft className="size-5" aria-hidden />
            Escolher portal
          </Link>
          <Link to={paths.splash} aria-label="Vita Family, página inicial" className="lg:hidden">
            <Logo />
          </Link>
        </div>

        <div className="relative mx-auto flex w-full max-w-lg flex-1 animate-rise flex-col justify-center gap-8 px-6 py-12 lg:px-0">
          <div className="flex flex-col gap-5">
            <span className="flex w-fit items-center gap-2 rounded-full bg-primary-soft px-4 py-2 text-base font-semibold text-primary">
              <BadgeIcon className="size-5" aria-hidden />
              {badge}
            </span>
            <h1 className="text-4xl leading-[1.1] font-bold tracking-tight text-balance md:text-5xl">{title}</h1>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
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
              placeholder={passwordPlaceholder}
              autoComplete="current-password"
              error={errors.password?.message}
              {...register('password')}
            />
            <FormError message={formError} />
            <Button type="submit" size="lg" fullWidth loading={isSubmitting} className="h-14 text-base">
              Entrar
            </Button>
          </form>

          <p className="text-base text-muted">
            Sem acesso?{' '}
            <Link to={requestAccessTo} className="font-semibold text-primary hover:underline">
              Solicitar acesso
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
