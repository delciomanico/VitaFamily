import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ArrowRight, Building2, ShieldCheck, Users } from 'lucide-react'
import { usePageTitle } from '@/hooks/usePageTitle'
import { paths } from '@/routes/paths'

interface PortalCard {
  title: string
  text: string
  icon: LucideIcon
  login: string
  loginLabel: string
  extra: { to: string; label: string }
}

const cards: PortalCard[] = [
  {
    title: 'Famílias',
    text: 'Gira a saúde da sua família, marque consultas e acompanhe a medicação.',
    icon: Users,
    login: paths.login,
    loginLabel: 'Entrar como família',
    extra: { to: paths.register, label: 'Criar conta' },
  },
  {
    title: 'Clínicas',
    text: 'Agenda, pacientes, exames, relatórios e recibos da sua clínica.',
    icon: Building2,
    login: paths.clinicLogin,
    loginLabel: 'Entrar no portal da clínica',
    extra: { to: paths.requestAccess('clinica'), label: 'Solicitar acesso' },
  },
  {
    title: 'Seguradoras',
    text: 'Beneficiários, apólices, planos, rede de clínicas e reembolsos.',
    icon: ShieldCheck,
    login: paths.insuranceLogin,
    loginLabel: 'Entrar no portal da seguradora',
    extra: { to: paths.requestAccess('seguradora'), label: 'Solicitar acesso' },
  },
]

/** Hub de entrada: o utilizador escolhe o seu perfil e segue para o login certo. */
export function EnterPage() {
  usePageTitle('Entrar')
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 lg:px-8 lg:py-16">
      <h1 className="text-[1.75rem] leading-tight font-bold tracking-tight">Como pretende entrar?</h1>
      <p className="mt-2 max-w-xl text-muted">
        Escolha o seu perfil. Cada portal tem contas próprias, por isso a sessão de um não dá acesso ao outro.
      </p>
      <ul className="mt-8 grid gap-4 md:grid-cols-3">
        {cards.map(({ title, text, icon: Icon, login, loginLabel, extra }) => (
          <li key={title} className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 shadow-card">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <Icon className="size-6" aria-hidden />
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-bold">{title}</h2>
              <p className="mt-1 text-sm text-muted">{text}</p>
            </div>
            <Link
              to={login}
              className="flex h-11 items-center justify-between rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground shadow-button hover:bg-primary-hover"
            >
              {loginLabel}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link to={extra.to} className="text-center text-sm font-semibold text-primary hover:underline">
              {extra.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
