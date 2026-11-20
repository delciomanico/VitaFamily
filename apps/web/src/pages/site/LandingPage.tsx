import type { ReactNode } from 'react'
import { ArrowRight, CalendarCheck, Check, Lock, Pill, Stethoscope, Users } from 'lucide-react'
import { ButtonLink } from '@/components/ui/Button'
import { HeroMedia } from '@/components/ui/HeroMedia'
import { Reveal } from '@/components/ui/Reveal'
import { usePageTitle } from '@/hooks/usePageTitle'
import { OnboardingPreview } from '@/pages/public/OnboardingPreview'
import { paths } from '@/routes/paths'

const bigButton = 'h-14 px-8 text-base'

/** Fotografias do carrossel do hero. */
const HERO_IMAGES = [
  { src: '/images/site/familia.webp' },
  { src: '/images/site/consulta.webp' },
  { src: '/images/site/medicacao.webp' },
]

/** Vídeo do hero: colocar os ficheiros em apps/web/public/videos/. Sem eles, fica a fotografia. */
const HERO_VIDEO = [
  { src: '/videos/hero.webm', type: 'video/webm' },
  { src: '/videos/hero.mp4', type: 'video/mp4' },
]

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-base font-semibold tracking-wide text-primary uppercase">{children}</p>
}

function Heading({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={`text-[1.5rem] leading-[1.1] font-bold tracking-tight text-balance md:text-5xl lg:text-6xl ${className}`}>
      {children}
    </h2>
  )
}

/** Página inicial pública: poucas ideias, muito espaço e uma chamada à ação clara por perfil. */
export function LandingPage() {
  usePageTitle()
  return (
    <>
      {/* Hero com vídeo de fundo */}
      <div className="relative">
      <section className="relative isolate flex min-h-[calc(100dvh-10rem)] overflow-hidden text-white">
        <HeroMedia images={HERO_IMAGES} sources={HERO_VIDEO} />
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-black/65 via-black/35 to-transparent" />
        <div aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-2/5 bg-gradient-to-t from-black/60 to-transparent" />

        <div className="mx-auto flex w-full max-w-7xl flex-col px-5 pt-16 pb-24 lg:px-10 lg:pt-20 lg:pb-28">
          <div className="flex flex-1 items-center">
            <div className="flex max-w-3xl animate-rise flex-col items-start gap-8">
              <span className="rounded-full border border-white/30 bg-white/10 px-4 py-2 text-base font-semibold backdrop-blur">
                Saúde familiar, organizada
              </span>
              <h1 className="text-5xl leading-[1.05] font-bold tracking-tight text-balance md:text-6xl lg:text-7xl">
                A saúde de toda a família, num só lugar.
              </h1>
              <p className="max-w-xl text-xl text-white md:text-2xl md:leading-9">
                Medicação, consultas e exames de cada pessoa, ligados à sua clínica.
              </p>
              <div className="flex flex-wrap gap-4 pt-2">
                <ButtonLink to={paths.register} variant="secondary" size="lg" className={bigButton}>
                  Criar conta gratuita
                </ButtonLink>
                <a
                  href="#como-funciona"
                  className={`inline-flex items-center justify-center gap-2 rounded-full font-medium text-white transition-colors hover:bg-white/15 ${bigButton}`}
                >
                  Ver como funciona
                  <ArrowRight className="size-5" aria-hidden />
                </a>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* Acessos: centrados na borda inferior do hero, mais largos que o texto */}
      <div className="relative z-10 mx-auto -mt-12 w-[calc(100%-2.5rem)] max-w-[90rem] animate-rise [animation-delay:200ms] md:absolute md:inset-x-0 md:bottom-0 md:mt-0 md:w-[calc(100%-5rem)] md:translate-y-1/2">
      <ul className="grid bg-surface text-foreground shadow-overlay md:grid-cols-2 md:divide-x md:divide-border max-md:divide-y max-md:divide-border">
        {[
          [Users, 'Famílias', 'Organize a saúde de todos', '#familias'],
          [Stethoscope, 'Clínicas', 'Agenda e pacientes ligados', paths.clinics],
        ].map(([Icon, title, text, href]) => {
          const I = Icon as typeof Users
          return (
            <li key={title as string}>
              <a
                href={href as string}
                className="group flex items-center gap-5 p-8 transition-colors hover:bg-primary-soft lg:p-10"
              >
                <span className="flex size-14 shrink-0 items-center justify-center bg-primary-soft text-primary transition-colors group-hover:bg-surface">
                  <I className="size-7" aria-hidden />
                </span>
                <span className="flex-1">
                  <span className="block text-xl font-semibold">{title as string}</span>
                  <span className="block text-base text-muted">{text as string}</span>
                </span>
                <ArrowRight className="size-6 text-primary transition-transform group-hover:translate-x-1" aria-hidden />
              </a>
            </li>
          )
        })}
      </ul>
      </div>
      </div>

      {/* Como funciona */}
      <section id="como-funciona" className="scroll-mt-20 bg-surface">
        <div className="mx-auto max-w-7xl px-5 py-24 md:pt-48 lg:px-10 lg:py-36 lg:pt-60">
          <Reveal>
            <Eyebrow>Como funciona</Eyebrow>
            <Heading className="mt-4 max-w-3xl">Três passos. Sem papéis perdidos.</Heading>
          </Reveal>
          <ol className="mt-16 grid gap-12 md:grid-cols-3 md:gap-10">
            {[
              ['1', 'Crie a família', 'Adicione filhos, pais e outros dependentes numa só conta.'],
              ['2', 'Registe e seja lembrado', 'Receitas, consultas e exames com alertas na hora certa.'],
              ['3', 'Ligue a clínica', 'Só partilha o que quiser, e pode retirar quando quiser.'],
            ].map(([n, title, text], index) => (
              <li key={n}>
                <Reveal delay={index * 120} className="flex flex-col gap-4">
                  <span className="text-7xl leading-none font-bold text-primary/25">{n}</span>
                  <h3 className="text-2xl font-bold">{title}</h3>
                  <p className="text-lg text-muted">{text}</p>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Famílias */}
      <section id="familias" className="scroll-mt-20">
        <div className="mx-auto grid max-w-7xl items-center gap-16 px-5 py-24 lg:grid-cols-2 lg:gap-24 lg:px-10 lg:py-36">
          <Reveal className="order-2 lg:order-1">
            <div className="relative mx-auto h-[30rem] w-full max-w-md overflow-hidden rounded-[2.5rem] bg-primary-soft px-10 pt-12">
              <div aria-hidden className="absolute -right-16 -bottom-16 size-72 animate-drift rounded-full bg-accent/30 blur-2xl" />
              <div className="relative h-full">
                <OnboardingPreview kind="reminders" />
              </div>
            </div>
          </Reveal>
          <Reveal delay={100} className="order-1 flex flex-col gap-8 lg:order-2">
            <Eyebrow>Para famílias</Eyebrow>
            <Heading>Quem cuida de todos, com tudo à mão.</Heading>
            <ul className="flex flex-col gap-6">
              {[
                [Pill, 'Medicação sem falhas', 'Alertas de toma e acompanhamento do tratamento.'],
                [CalendarCheck, 'Consultas e exames', 'Marque na sua clínica e leve o histórico consigo.'],
              ].map(([Icon, title, text]) => {
                const I = Icon as typeof Pill
                return (
                  <li key={title as string} className="flex items-start gap-4">
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                      <I className="size-6" aria-hidden />
                    </span>
                    <span>
                      <span className="block text-xl font-semibold">{title as string}</span>
                      <span className="block text-lg text-muted">{text as string}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
            <div>
              <ButtonLink to={paths.register} size="lg" className={bigButton}>
                Começar agora
              </ButtonLink>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Clínicas */}
      <section className="bg-surface-muted">
        <div className="mx-auto max-w-7xl px-5 py-24 lg:px-10 lg:py-36">
          <Reveal>
            <Eyebrow>Para profissionais</Eyebrow>
            <Heading className="mt-4 max-w-3xl">Clínicas ligadas às famílias.</Heading>
          </Reveal>
          <div className="mt-16 grid gap-8">
            <Reveal>
              <article
                id="clinicas"
                className="group flex h-full scroll-mt-24 flex-col overflow-hidden rounded-[2rem] bg-surface shadow-card transition-shadow duration-300 hover:shadow-overlay"
              >
                <img
                  src="/images/site/consulta.webp"
                  alt="Médico e enfermeira a observar uma criança com a mãe"
                  width={1536}
                  height={864}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[3/2] w-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="flex flex-1 flex-col gap-4 p-8 lg:p-10">
                  <Stethoscope className="size-8 text-primary" aria-hidden />
                  <h3 className="text-3xl font-bold tracking-tight">Clínicas</h3>
                  <p className="text-lg text-muted">Agenda, pacientes, exames e laudos, num portal simples.</p>
                  <div className="mt-auto flex flex-wrap gap-3 pt-4">
                    <ButtonLink to={paths.clinics} size="lg">
                      Saber mais
                    </ButtonLink>
                    <ButtonLink to={paths.clinicLogin} variant="secondary" size="lg">
                      Entrar no portal
                    </ButtonLink>
                  </div>
                </div>
              </article>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Privacidade */}
      <section>
        <div className="mx-auto max-w-5xl px-5 py-24 text-center lg:px-10 lg:py-36">
          <Reveal className="flex flex-col items-center gap-8">
            <span className="flex size-16 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <Lock className="size-8" aria-hidden />
            </span>
            <Heading>Os seus dados de saúde são seus.</Heading>
            <p className="max-w-2xl text-xl text-muted">
              Privados por defeito. Só partilha com quem escolher, e pode retirar o consentimento quando quiser.
            </p>
            <ul className="flex flex-wrap justify-center gap-3 pt-2">
              {['Privado por defeito', 'Partilha com consentimento'].map((label) => (
                <li key={label} className="flex items-center gap-2 rounded-full bg-surface px-5 py-3 text-base font-medium shadow-card">
                  <Check className="size-5 text-success" aria-hidden />
                  {label}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* Chamada final */}
      <section className="px-5 pb-24 lg:px-10 lg:pb-36">
        <Reveal>
          <div className="relative mx-auto flex max-w-7xl flex-col items-start gap-8 overflow-hidden rounded-[2.5rem] bg-primary px-8 py-16 text-white md:px-16 md:py-24">
            <div aria-hidden className="absolute -right-24 -bottom-24 size-96 animate-drift rounded-full bg-white/10 blur-2xl" />
            <Users className="relative size-12 text-white/90" aria-hidden />
            <h2 className="relative max-w-3xl text-4xl leading-tight font-bold tracking-tight text-balance md:text-6xl">
              Comece hoje a cuidar da sua família.
            </h2>
            <div className="relative flex flex-wrap gap-4">
              <ButtonLink to={paths.register} variant="secondary" size="lg" className={bigButton}>
                Criar conta gratuita
              </ButtonLink>
              <ButtonLink to={paths.contact} variant="ghost" size="lg" className={`${bigButton} text-white hover:bg-white/15`}>
                Falar connosco
              </ButtonLink>
            </div>
          </div>
        </Reveal>
      </section>
    </>
  )
}
