import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ArrowRight, Building2, LockKeyhole, ShieldCheck, Users } from 'lucide-react'
import { Reveal } from '@/components/ui/Reveal'
import { useAppEntry } from '@/hooks/useAppEntry'
import { usePageTitle } from '@/hooks/usePageTitle'
import { paths } from '@/routes/paths'

interface PortalCard {
  title: string
  text: string
  icon: LucideIcon
  image: string
  login: string
  loginLabel: string
  extra: { to: string; label: string }
}

const cards: PortalCard[] = [
  {
    title: 'Famílias',
    text: 'Medicação, consultas e exames de toda a família.',
    icon: Users,
    image: '/images/site/familia.webp',
    login: paths.login,
    loginLabel: 'Entrar como família',
    extra: { to: paths.register, label: 'Criar conta gratuita' },
  },
  {
    title: 'Clínicas',
    text: 'Agenda, pacientes, exames e laudos num só portal.',
    icon: Building2,
    image: '/images/site/consulta.webp',
    login: paths.clinicLogin,
    loginLabel: 'Entrar como clínica',
    extra: { to: paths.requestAccess('clinica'), label: 'Solicitar acesso' },
  },
  {
    title: 'Seguradoras',
    text: 'Beneficiários, planos, rede de clínicas e reembolsos.',
    icon: ShieldCheck,
    image: '/images/site/recepcao.webp',
    login: paths.insuranceLogin,
    loginLabel: 'Entrar como seguradora',
    extra: { to: paths.requestAccess('seguradora'), label: 'Solicitar acesso' },
  },
]

/** Hub de entrada: o utilizador escolhe o perfil e segue para o login certo (inclui o backoffice). */
export function EnterPage() {
  usePageTitle('Entrar')
  const appEntry = useAppEntry()
  return (
    <>
      <section className="relative overflow-hidden bg-surface">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -top-32 -left-24 size-[30rem] animate-drift rounded-full bg-primary-soft blur-3xl" />
          <div className="absolute top-20 -right-24 size-[26rem] animate-drift rounded-full bg-accent/20 blur-3xl [animation-delay:-6s]" />
        </div>
        <div className="relative mx-auto max-w-7xl animate-rise px-5 py-20 lg:px-10 lg:py-28">
          <p className="text-base font-semibold tracking-wide text-primary uppercase">Entrar</p>
          <h1 className="mt-4 max-w-3xl text-4xl leading-[1.1] font-bold tracking-tight text-balance md:text-6xl">
            Como pretende entrar?
          </h1>
          <p className="mt-5 max-w-2xl text-xl text-muted">
            Escolha o seu perfil. Cada portal tem contas próprias, por isso a sessão de um não dá acesso ao outro.
          </p>
        </div>
      </section>

      <section className="bg-surface-muted">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-10 lg:py-24">
          <ul className="grid gap-8 md:grid-cols-3">
            {cards.map(({ title, text, icon: Icon, image, login: loginTo, loginLabel: loginText, extra: extraLink }, index) => {
              // Com sessão de família já aberta, o cartão leva direto à app.
              const signedIn = title === 'Famílias' && appEntry
              const login = signedIn ? appEntry : loginTo
              const loginLabel = signedIn ? 'Abrir a minha área' : loginText
              const extra = signedIn ? null : extraLink
              return (
                <li key={title} className="flex">
                  <Reveal delay={index * 120} className="flex w-full">
                    <article className="group flex w-full flex-col overflow-hidden rounded-[2rem] bg-surface shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-overlay">
                      <div className="relative aspect-[3/2] overflow-hidden">
                        <img
                          src={image}
                          alt=""
                          width={1536}
                          height={864}
                          decoding="async"
                          className="size-full object-cover object-[70%_center] transition-transform duration-700 group-hover:scale-105"
                        />
                        <span className="absolute bottom-4 left-4 flex size-12 items-center justify-center rounded-2xl bg-surface text-primary shadow-card">
                          <Icon className="size-6" aria-hidden />
                        </span>
                      </div>
                      <div className="flex flex-1 flex-col gap-5 p-8">
                        <div className="flex-1">
                          <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
                          <p className="mt-2 text-lg text-muted">{text}</p>
                        </div>
                        <Link
                          to={login}
                          className="flex h-14 items-center justify-between rounded-full bg-primary px-7 text-base font-medium text-primary-foreground shadow-button transition-colors hover:bg-primary-hover"
                        >
                          {loginLabel}
                          <ArrowRight className="size-5 transition-transform group-hover:translate-x-1" aria-hidden />
                        </Link>
                        {extra && (
                          <Link to={extra.to} className="text-center text-base font-semibold text-primary hover:underline">
                            {extra.label}
                          </Link>
                        )}
                      </div>
                    </article>
                  </Reveal>
                </li>
              )
            })}
          </ul>

          <Reveal delay={200} className="mt-8">
            <Link
              to={paths.backofficeLogin}
              className="group relative flex flex-col gap-6 overflow-hidden rounded-[2rem] bg-foreground p-8 text-white shadow-card transition-shadow duration-300 hover:shadow-overlay md:flex-row md:items-center md:justify-between lg:p-10"
            >
              <div aria-hidden className="absolute -top-24 -right-16 size-72 animate-drift rounded-full bg-primary/40 blur-3xl" />
              <div className="relative flex items-center gap-5">
                <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-white/10">
                  <LockKeyhole className="size-8" aria-hidden />
                </span>
                <span>
                  <span className="block text-2xl font-bold tracking-tight">Entrar como backoffice</span>
                  <span className="block text-lg text-white/90">Acesso interno da equipa Vita Family: contas, clínicas e seguradoras.</span>
                </span>
              </div>
              <span className="relative flex h-14 shrink-0 items-center gap-3 rounded-full bg-white px-7 text-base font-medium text-foreground transition-colors group-hover:bg-primary-soft">
                Aceder
                <ArrowRight className="size-5 transition-transform group-hover:translate-x-1" aria-hidden />
              </span>
            </Link>
          </Reveal>
        </div>
      </section>
    </>
  )
}
