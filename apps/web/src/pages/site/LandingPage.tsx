import type { ReactNode } from 'react'
import { ArrowRight, CalendarCheck, Check, Lock, Pill, QrCode, ShieldCheck, Stethoscope, Users } from 'lucide-react'
import { ButtonLink } from '@/components/ui/Button'
import { Reveal } from '@/components/ui/Reveal'
import { usePageTitle } from '@/hooks/usePageTitle'
import { OnboardingPreview } from '@/pages/public/OnboardingPreview'
import { paths } from '@/routes/paths'

const bigButton = 'h-14 px-8 text-base'

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-base font-semibold tracking-wide text-primary uppercase">{children}</p>
}

function Heading({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={`text-[2.25rem] leading-[1.1] font-bold tracking-tight text-balance md:text-5xl lg:text-6xl ${className}`}>
      {children}
    </h2>
  )
}

/** Cartão decorativo que flutua sobre a fotografia do hero. */
function FloatingCard({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div
      aria-hidden
      className={`absolute flex items-center gap-3 rounded-2xl border border-border bg-surface/95 px-4 py-3 shadow-overlay backdrop-blur ${className}`}
    >
      {children}
    </div>
  )
}

/** Página inicial pública: poucas ideias, muito espaço e uma chamada à ação clara por perfil. */
export function LandingPage() {
  usePageTitle()
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -top-32 -left-24 size-[32rem] animate-drift rounded-full bg-primary-soft blur-3xl" />
          <div className="absolute top-40 -right-32 size-[28rem] animate-drift rounded-full bg-accent/20 blur-3xl [animation-delay:-6s]" />
        </div>
        <div className="relative mx-auto grid max-w-7xl items-center gap-16 px-5 py-20 lg:grid-cols-2 lg:px-10 lg:py-32">
          <div className="flex animate-rise flex-col items-start gap-8">
            <span className="rounded-full bg-primary-soft px-4 py-2 text-base font-semibold text-primary">
              Saúde familiar, organizada
            </span>
            <h1 className="text-5xl leading-[1.05] font-bold tracking-tight text-balance md:text-6xl lg:text-7xl">
              A saúde de toda a família, num só lugar.
            </h1>
            <p className="max-w-lg text-xl text-muted md:text-2xl md:leading-9">
              Medicação, consultas e exames de cada pessoa, ligados à sua clínica e seguradora.
            </p>
            <div className="flex flex-wrap gap-4 pt-2">
              <ButtonLink to={paths.register} size="lg" className={bigButton}>
                Criar conta gratuita
              </ButtonLink>
              <a
                href="#como-funciona"
                className={`inline-flex items-center justify-center gap-2 rounded-full font-medium text-foreground transition-colors hover:bg-surface-muted ${bigButton}`}
              >
                Ver como funciona
                <ArrowRight className="size-5" aria-hidden />
              </a>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-xl animate-rise [animation-delay:150ms]">
            <img
              src="/images/login/familia.webp"
              alt="Família de várias gerações a conversar no sofá"
              width={800}
              height={534}
              decoding="async"
              className="aspect-[4/5] w-full rounded-[2.5rem] object-cover shadow-overlay sm:aspect-[5/4]"
            />
            <FloatingCard className="top-8 -left-4 animate-float sm:-left-10">
              <span className="flex size-11 items-center justify-center rounded-full bg-success-soft text-success">
                <Check className="size-6" aria-hidden />
              </span>
              <span>
                <span className="block text-sm text-muted">Medicação · 08:00</span>
                <span className="block text-base font-semibold">Toma confirmada</span>
              </span>
            </FloatingCard>
            <FloatingCard className="-right-3 bottom-10 animate-float-delayed sm:-right-8">
              <span className="flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary">
                <CalendarCheck className="size-6" aria-hidden />
              </span>
              <span>
                <span className="block text-sm text-muted">Amanhã · 10:30</span>
                <span className="block text-base font-semibold">Consulta de pediatria</span>
              </span>
            </FloatingCard>
          </div>
        </div>
      </section>

      {/* Como funciona */}
      <section id="como-funciona" className="scroll-mt-20 bg-surface">
        <div className="mx-auto max-w-7xl px-5 py-24 lg:px-10 lg:py-36">
          <Reveal>
            <Eyebrow>Como funciona</Eyebrow>
            <Heading className="mt-4 max-w-3xl">Três passos. Sem papéis perdidos.</Heading>
          </Reveal>
          <ol className="mt-16 grid gap-12 md:grid-cols-3 md:gap-10">
            {[
              ['1', 'Crie a família', 'Adicione filhos, pais e outros dependentes numa só conta.'],
              ['2', 'Registe e seja lembrado', 'Receitas, consultas e exames com alertas na hora certa.'],
              ['3', 'Ligue a clínica e o seguro', 'Só partilha o que quiser, e pode retirar quando quiser.'],
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
                [QrCode, 'Cartão do seguro', 'A apólice sempre consigo, com pedidos de reembolso.'],
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

      {/* Clínicas e seguradoras */}
      <section className="bg-surface-muted">
        <div className="mx-auto max-w-7xl px-5 py-24 lg:px-10 lg:py-36">
          <Reveal>
            <Eyebrow>Para profissionais</Eyebrow>
            <Heading className="mt-4 max-w-3xl">Clínicas e seguradoras, ligadas às famílias.</Heading>
          </Reveal>
          <div className="mt-16 grid gap-8 lg:grid-cols-2">
            <Reveal>
              <article
                id="clinicas"
                className="group flex h-full scroll-mt-24 flex-col overflow-hidden rounded-[2rem] bg-surface shadow-card transition-shadow duration-300 hover:shadow-overlay"
              >
                <img
                  src="/images/login/consulta.webp"
                  alt="Médico e enfermeira a observar uma criança com a mãe"
                  width={600}
                  height={400}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[3/2] w-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="flex flex-1 flex-col gap-4 p-8 lg:p-10">
                  <Stethoscope className="size-8 text-primary" aria-hidden />
                  <h3 className="text-3xl font-bold tracking-tight">Clínicas</h3>
                  <p className="text-lg text-muted">Agenda, pacientes, exames e laudos, num portal simples.</p>
                  <div className="mt-auto flex flex-wrap gap-3 pt-4">
                    <ButtonLink to={paths.clinicLogin} size="lg">
                      Entrar no portal
                    </ButtonLink>
                    <ButtonLink to={paths.requestAccess('clinica')} variant="secondary" size="lg">
                      Solicitar acesso
                    </ButtonLink>
                  </div>
                </div>
              </article>
            </Reveal>
            <Reveal delay={150}>
              <article
                id="seguradoras"
                className="group relative flex h-full scroll-mt-24 flex-col overflow-hidden rounded-[2rem] bg-primary p-8 text-white shadow-card transition-shadow duration-300 hover:shadow-overlay lg:p-10"
              >
                <div aria-hidden className="absolute -top-20 -right-20 size-72 animate-drift rounded-full bg-white/10 blur-2xl" />
                <ShieldCheck className="relative size-20 text-white/90 transition-transform duration-500 group-hover:scale-110" strokeWidth={1.25} aria-hidden />
                <div className="relative mt-auto flex flex-col gap-4 pt-24">
                  <h3 className="text-3xl font-bold tracking-tight">Seguradoras</h3>
                  <p className="text-lg text-white">Beneficiários, planos, rede de clínicas e reembolsos.</p>
                  <div className="flex flex-wrap gap-3 pt-4">
                    <ButtonLink to={paths.insuranceLogin} variant="secondary" size="lg">
                      Entrar no portal
                    </ButtonLink>
                    <ButtonLink to={paths.requestAccess('seguradora')} variant="ghost" size="lg" className="text-white hover:bg-white/15">
                      Solicitar acesso
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
              {['Privado por defeito', 'Partilha com consentimento', 'A seguradora não vê o seu perfil de saúde'].map((label) => (
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
