import type { LucideIcon } from 'lucide-react'
import {
  BellRing,
  CalendarCheck,
  ClipboardCheck,
  FileText,
  HeartPulse,
  Lock,
  Pill,
  QrCode,
  ShieldCheck,
  Stethoscope,
  Users,
} from 'lucide-react'
import { ButtonLink } from '@/components/ui/Button'
import { usePageTitle } from '@/hooks/usePageTitle'
import { paths } from '@/routes/paths'

function Feature({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
        <Icon className="size-5" aria-hidden />
      </span>
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-muted">{text}</p>
      </div>
    </li>
  )
}

function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
  tone = 'plain',
}: {
  id: string
  eyebrow: string
  title: string
  lead: string
  children: React.ReactNode
  tone?: 'plain' | 'muted'
}) {
  return (
    <section id={id} className={tone === 'muted' ? 'scroll-mt-16 bg-surface-muted' : 'scroll-mt-16 bg-surface'}>
      <div className="mx-auto max-w-6xl px-4 py-14 lg:px-8 lg:py-20">
        <p className="text-sm font-semibold tracking-wide text-primary uppercase">{eyebrow}</p>
        <h2 className="mt-2 max-w-2xl text-[1.75rem] leading-tight font-bold tracking-tight">{title}</h2>
        <p className="mt-3 max-w-2xl text-muted">{lead}</p>
        <div className="mt-8">{children}</div>
      </div>
    </section>
  )
}

/** Página inicial pública: proposta de valor e entrada para cada portal. */
export function LandingPage() {
  usePageTitle()
  return (
    <>
      <section className="bg-primary text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:px-8 lg:py-24">
          <div className="flex flex-col gap-5">
            <h1 className="text-[2rem] leading-tight font-bold tracking-tight lg:text-[2.75rem]">
              A saúde de toda a família, num só lugar seguro.
            </h1>
            <p className="max-w-xl text-lg text-white">
              Receitas, medicação, consultas e exames de cada membro, ligados às clínicas e seguradoras que os
              acompanham, sempre com o seu consentimento.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <ButtonLink to={paths.register} size="lg" variant="secondary">
                Criar conta gratuita
              </ButtonLink>
              <ButtonLink to={paths.enter} size="lg" variant="ghost" className="text-white hover:bg-white/15">
                Entrar
              </ButtonLink>
            </div>
          </div>
          <ul className="grid gap-3 rounded-3xl bg-white/10 p-5 text-sm backdrop-blur" aria-label="Em resumo">
            {[
              [Users, 'Uma conta, toda a família, incluindo filhos e dependentes'],
              [Pill, 'Lembretes de medicação e confirmação de tomas'],
              [Stethoscope, 'Clínicas parceiras e marcação de consultas e exames'],
              [ShieldCheck, 'Partilha só com o seu consentimento, revogável a qualquer momento'],
            ].map(([Icon, text]) => {
              const I = Icon as LucideIcon
              return (
                <li key={text as string} className="flex items-center gap-3">
                  <I className="size-5 shrink-0" aria-hidden />
                  <span>{text as string}</span>
                </li>
              )
            })}
          </ul>
        </div>
      </section>

      <Section
        id="familias"
        eyebrow="Para famílias"
        title="Tudo o que precisa de saber sobre a saúde de quem cuida."
        lead="Deixe de procurar papéis e de se esquecer de doses. O Vita Family organiza o histórico e lembra o que é preciso fazer."
      >
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Feature icon={Users} title="Família e dependentes" text="Gira os perfis dos seus filhos e familiares, com tutores e permissões por pessoa." />
          <Feature icon={Pill} title="Medicação sem falhas" text="Planos de toma, alertas e acompanhamento da adesão ao tratamento." />
          <Feature icon={FileText} title="Receitas, exames e documentos" text="Guarde e consulte tudo no mesmo sítio, pronto para levar à consulta." />
          <Feature icon={CalendarCheck} title="Consultas e exames" text="Marque junto de clínicas parceiras e receba lembretes e confirmações." />
          <Feature icon={BellRing} title="Alertas úteis" text="Avisos de agenda e recomendações da clínica, com texto discreto." />
          <Feature icon={QrCode} title="Cartão do seguro" text="Guarde a apólice, mostre o cartão e peça reembolsos com os documentos que escolher." />
        </ul>
        <div className="mt-8">
          <ButtonLink to={paths.register}>Começar agora</ButtonLink>
        </div>
      </Section>

      <Section
        id="clinicas"
        eyebrow="Para clínicas"
        title="Menos faltas, agenda organizada, pacientes mais bem acompanhados."
        lead="Um portal para a receção e para os médicos, com a agenda do dia, exames, laudos e recibos."
        tone="muted"
      >
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Feature icon={CalendarCheck} title="Agenda e vagas" text="Horários por profissional, marcações diretas e confirmação 48 h/24 h antes." />
          <Feature icon={ClipboardCheck} title="Relatório e laudo" text="Relatório da consulta, laudo em PDF e pedidos de exame para o paciente." />
          <Feature icon={HeartPulse} title="Pacientes com consentimento" text="Ligue-se ao paciente por código ou QR e partilhe o histórico só se ele autorizar." />
          <Feature icon={ShieldCheck} title="Elegibilidade de seguros" text="Consulte rapidamente a cobertura do paciente nas seguradoras ligadas." />
        </ul>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink to={paths.clinicLogin}>Entrar no portal</ButtonLink>
          <ButtonLink to={paths.requestAccess('clinica')} variant="secondary">
            Solicitar acesso
          </ButtonLink>
        </div>
      </Section>

      <Section
        id="seguradoras"
        eyebrow="Para seguradoras"
        title="Beneficiários, planos e rede de prestadores ligados às famílias."
        lead="Um portal para gerir beneficiários e apólices, validar elegibilidade e analisar pedidos de reembolso."
      >
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Feature icon={Users} title="Beneficiários e apólices" text="Importação em lote, empresas, planos e coberturas num só painel." />
          <Feature icon={QrCode} title="Cartão com QR" text="O segurado reclama o cartão e a clínica valida a elegibilidade na hora." />
          <Feature icon={FileText} title="Reembolsos" text="Pedidos com os documentos que o titular escolheu anexar, com estados claros." />
          <Feature icon={Stethoscope} title="Rede de clínicas" text="Defina as clínicas parceiras e os serviços cobertos por plano." />
        </ul>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink to={paths.insuranceLogin}>Entrar no portal</ButtonLink>
          <ButtonLink to={paths.requestAccess('seguradora')} variant="secondary">
            Solicitar acesso
          </ButtonLink>
        </div>
      </Section>

      <section className="bg-surface-muted">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 lg:grid-cols-2 lg:px-8 lg:py-20">
          <div>
            <p className="text-sm font-semibold tracking-wide text-primary uppercase">Privacidade</p>
            <h2 className="mt-2 text-[1.75rem] leading-tight font-bold tracking-tight">
              Os seus dados de saúde são seus.
            </h2>
            <p className="mt-3 text-muted">
              Tratamos dados sensíveis com o rigor que merecem: privado por defeito, partilha por categoria e por
              clínica, auditoria de acessos e eliminação a pedido.
            </p>
          </div>
          <ul className="flex flex-col gap-4">
            <Feature icon={Lock} title="Privado por defeito" text="Só o próprio e os tutores veem o perfil de saúde." />
            <Feature icon={ShieldCheck} title="A seguradora não vê o seu perfil de saúde" text="Só os dados da apólice e os documentos que escolher anexar a um reembolso." />
            <Feature icon={Stethoscope} title="Clínica só com o seu consentimento" text="Dois níveis, por clínica, válidos 12 meses e revogáveis." />
          </ul>
        </div>
      </section>

      <section className="bg-primary text-white">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-4 py-12 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <p className="max-w-xl text-xl font-bold tracking-tight">Pronto para organizar a saúde da sua família?</p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink to={paths.register} variant="secondary" size="lg">
              Criar conta gratuita
            </ButtonLink>
            <ButtonLink to={paths.contact} variant="ghost" size="lg" className="text-white hover:bg-white/15">
              Falar connosco
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  )
}
