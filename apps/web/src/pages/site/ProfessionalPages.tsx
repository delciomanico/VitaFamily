import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  Building2,
  CalendarCheck,
  ClipboardCheck,
  FileText,
  HeartPulse,
  Lock,
  QrCode,
} from 'lucide-react'
import { ButtonLink } from '@/components/ui/Button'
import { HeroMedia } from '@/components/ui/HeroMedia'
import { Reveal } from '@/components/ui/Reveal'
import { usePageTitle } from '@/hooks/usePageTitle'
import { paths } from '@/routes/paths'

interface Point {
  icon: LucideIcon
  title: string
  text: string
}

interface ProfessionalContent {
  title: string
  eyebrow: string
  headline: string
  lead: string
  images: string[]
  loginPath: string
  requestPath: string
  benefits: Point[]
  steps: { title: string; text: string }[]
  roles: { name: string; text: string }[]
  privacy: string[]
  notYet: string[]
  faq: { q: string; a: string }[]
}

const clinics: ProfessionalContent = {
  title: 'Clínicas',
  eyebrow: 'Para clínicas',
  headline: 'Uma agenda cheia e pacientes bem acompanhados.',
  lead: 'Um portal para a receção e para os médicos, ligado às famílias que usam o Vita Family.',
  images: ['/images/site/consulta.webp', '/images/site/recepcao.webp'],
  loginPath: paths.clinicLogin,
  requestPath: paths.requestAccess('clinica'),
  benefits: [
    { icon: CalendarCheck, title: 'Agenda e vagas', text: 'Horários por profissional, marcações diretas e fluxo do dia, com confirmação pedida 48 h e 24 h antes.' },
    { icon: QrCode, title: 'Ligação ao paciente', text: 'O paciente liga-se por código ou QR gerado na app. Sem consentimento, a clínica não vê nada.' },
    { icon: ClipboardCheck, title: 'Relatório e laudo', text: 'Relatório da consulta, laudo em PDF e pedidos de exame entregues ao paciente.' },
    { icon: HeartPulse, title: 'Exames e resultados', text: 'Registe resultados e recomendações; o paciente recebe-os na app, com alerta discreto.' },
    { icon: FileText, title: 'Recibos internos', text: 'Emita recibos não fiscais, imprima ou guarde em PDF e partilhe com o paciente.' },
  ],
  steps: [
    { title: 'Solicite acesso', text: 'Preencha o pedido com os dados da clínica.' },
    { title: 'Validamos a clínica', text: 'A equipa Vita Family confirma a entidade.' },
    { title: 'Receba a conta de administrador', text: 'Entre no portal e configure o perfil, os serviços e os horários.' },
    { title: 'Convide a equipa', text: 'Crie as contas de gestores e médicos, cada uma com o seu papel.' },
  ],
  roles: [
    { name: 'Administrador', text: 'Gere contas, definições e auditoria da clínica.' },
    { name: 'Gestor', text: 'Trata de pedidos, agenda, serviços, financeiro e relatórios.' },
    { name: 'Médico', text: 'Vê a sua agenda, os seus pacientes e os exames, sem acesso à gestão.' },
  ],
  privacy: [
    'A clínica é responsável pelo registo dos seus pacientes; o Vita Family trata os dados por sua conta.',
    'Os dados do paciente Vita só chegam com o consentimento dele, por clínica e em dois níveis: marcações; partilha de histórico (medicação e exames).',
    'O consentimento dura 12 meses, é renovável e pode ser retirado a qualquer momento. Ao retirar, a partilha futura pára de imediato.',
    'A clínica nunca vê dados de outras clínicas nem da família do paciente.',
  ],
  notYet: ['Faturação fiscal', 'Teleconsulta', 'Prontuário clínico completo'],
  faq: [
    { q: 'Tenho de usar o Vita Family em vez do meu sistema atual?', a: 'Não. O portal serve a agenda, os pacientes ligados e a troca com as famílias. Não substitui um sistema de gestão clínica completo.' },
    { q: 'O que acontece se o paciente retirar o consentimento?', a: 'A partilha futura pára de imediato. A clínica conserva o que ela própria registou.' },
    { q: 'Quanto custa?', a: 'Fale connosco para conhecer as condições.' },
  ],
}

function ProfessionalPage({ content }: { content: ProfessionalContent }) {
  usePageTitle(content.title)
  return (
    <>
      <section className="relative isolate flex min-h-[28rem] items-end overflow-hidden text-white lg:min-h-[34rem]">
        <HeroMedia images={content.images.map((src) => ({ src }))} />
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-black/80 via-black/45 to-black/20" />
        <div className="mx-auto w-full max-w-7xl animate-rise px-5 pt-24 pb-14 lg:px-10 lg:pb-20">
          <p className="text-base font-semibold tracking-wide uppercase">{content.eyebrow}</p>
          <h1 className="mt-4 max-w-4xl text-4xl leading-[1.08] font-bold tracking-tight text-balance md:text-6xl">{content.headline}</h1>
          <p className="mt-5 max-w-2xl text-xl md:text-2xl">{content.lead}</p>
          <div className="mt-8 flex flex-wrap gap-4">
            <ButtonLink to={content.requestPath} variant="secondary" size="lg" className="h-14 px-8 text-base">
              Solicitar acesso
            </ButtonLink>
            <ButtonLink to={content.loginPath} variant="ghost" size="lg" className="h-14 px-8 text-base text-white hover:bg-white/15">
              Entrar no portal
              <ArrowRight className="size-5" aria-hidden />
            </ButtonLink>
          </div>
        </div>
      </section>

      <section className="bg-surface">
        <div className="mx-auto max-w-7xl px-5 py-24 lg:px-10 lg:py-32">
          <Reveal>
            <p className="text-base font-semibold tracking-wide text-primary uppercase">O que pode fazer</p>
            <h2 className="mt-4 max-w-3xl text-4xl leading-[1.1] font-bold tracking-tight text-balance md:text-5xl">
              Tudo o que precisa no dia a dia.
            </h2>
          </Reveal>
          <ul className="mt-14 grid gap-x-12 gap-y-12 md:grid-cols-2 lg:grid-cols-3">
            {content.benefits.map(({ icon: Icon, title, text }, index) => (
              <li key={title}>
                <Reveal delay={(index % 3) * 100} className="flex flex-col gap-4">
                  <span className="flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                    <Icon className="size-7" aria-hidden />
                  </span>
                  <h3 className="text-2xl font-bold">{title}</h3>
                  <p className="text-lg text-muted">{text}</p>
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-7xl px-5 py-24 lg:px-10 lg:py-32">
          <Reveal>
            <p className="text-base font-semibold tracking-wide text-primary uppercase">Como começar</p>
            <h2 className="mt-4 max-w-3xl text-4xl leading-[1.1] font-bold tracking-tight text-balance md:text-5xl">
              Em quatro passos, com a nossa ajuda.
            </h2>
          </Reveal>
          <ol className="mt-14 grid gap-10 md:grid-cols-2 lg:grid-cols-4">
            {content.steps.map((step, index) => (
              <li key={step.title}>
                <Reveal delay={index * 100} className="flex flex-col gap-3">
                  <span className="text-6xl leading-none font-bold text-primary/25">{index + 1}</span>
                  <h3 className="text-xl font-bold">{step.title}</h3>
                  <p className="text-lg text-muted">{step.text}</p>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="bg-surface-muted">
        <div className="mx-auto grid max-w-7xl gap-16 px-5 py-24 lg:grid-cols-2 lg:px-10 lg:py-32">
          <Reveal className="flex flex-col gap-6">
            <p className="text-base font-semibold tracking-wide text-primary uppercase">Equipa</p>
            <h2 className="text-4xl leading-[1.1] font-bold tracking-tight text-balance md:text-5xl">Cada pessoa vê só o que precisa.</h2>
            <ul className="mt-2 flex flex-col gap-5">
              {content.roles.map((role) => (
                <li key={role.name} className="flex gap-4">
                  <Building2 className="mt-1 size-6 shrink-0 text-primary" aria-hidden />
                  <span>
                    <span className="block text-xl font-semibold">{role.name}</span>
                    <span className="block text-lg text-muted">{role.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={120} className="flex flex-col gap-6 rounded-[2rem] bg-surface p-8 shadow-card lg:p-10">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <Lock className="size-7" aria-hidden />
            </span>
            <h2 className="text-3xl font-bold tracking-tight">Privacidade e consentimento</h2>
            <ul className="flex flex-col gap-4 text-lg text-muted">
              {content.privacy.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      <section>
        <div className="mx-auto grid max-w-7xl gap-16 px-5 py-24 lg:grid-cols-2 lg:px-10 lg:py-32">
          <Reveal className="flex flex-col gap-5">
            <h2 className="text-3xl font-bold tracking-tight">Para ser transparentes</h2>
            <p className="text-lg text-muted">O que o portal ainda não faz:</p>
            <ul className="flex flex-col gap-3 text-lg">
              {content.notYet.map((item) => (
                <li key={item} className="rounded-2xl bg-surface-muted px-5 py-4">
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={120} className="flex flex-col gap-4">
            <h2 className="text-3xl font-bold tracking-tight">Perguntas frequentes</h2>
            {content.faq.map(({ q, a }) => (
              <details key={q} className="group rounded-2xl border border-border bg-surface p-5 shadow-card">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-lg font-semibold [&::-webkit-details-marker]:hidden">
                  {q}
                  <ArrowRight className="size-5 shrink-0 rotate-90 text-muted transition-transform group-open:-rotate-90" aria-hidden />
                </summary>
                <p className="mt-3 text-lg text-muted">{a}</p>
              </details>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="px-5 pb-24 lg:px-10 lg:pb-32">
        <Reveal>
          <div className="relative mx-auto flex max-w-7xl flex-col items-start gap-8 overflow-hidden rounded-[2.5rem] bg-primary px-8 py-16 text-white md:px-16 md:py-20">
            <div aria-hidden className="absolute -right-24 -bottom-24 size-96 animate-drift rounded-full bg-white/10 blur-2xl" />
            <h2 className="relative max-w-3xl text-4xl leading-tight font-bold tracking-tight text-balance md:text-5xl">
              Pronto para ligar a sua clínica às famílias?
            </h2>
            <div className="relative flex flex-wrap gap-4">
              <ButtonLink to={content.requestPath} variant="secondary" size="lg" className="h-14 px-8 text-base">
                Solicitar acesso
              </ButtonLink>
              <ButtonLink to={paths.contact} variant="ghost" size="lg" className="h-14 px-8 text-base text-white hover:bg-white/15">
                Falar connosco
              </ButtonLink>
            </div>
          </div>
        </Reveal>
      </section>
    </>
  )
}

export function ClinicsPage() {
  return <ProfessionalPage content={clinics} />
}
