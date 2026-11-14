import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowRight, Building2, CircleHelp, Mail, MailCheck, ShieldCheck } from 'lucide-react'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { HeroMedia } from '@/components/ui/HeroMedia'
import { Input } from '@/components/ui/Input'
import { Reveal } from '@/components/ui/Reveal'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { usePageTitle } from '@/hooks/usePageTitle'
import { mailto, site } from '@/lib/site'
import { paths } from '@/routes/paths'

const subjects = [
  'Apoio com a minha conta',
  'Quero ligar a minha clínica',
  'Quero ligar a minha seguradora',
  'Outro assunto',
]

const schema = z.object({
  name: z.string().trim().min(2, 'Indique o seu nome.').max(120),
  email: z.email('Introduza um e-mail válido.'),
  subject: z.string().min(1, 'Escolha um assunto.'),
  message: z.string().trim().min(10, 'Escreva pelo menos 10 caracteres.').max(1200),
})
type FormValues = z.infer<typeof schema>

const shortcuts = [
  { to: paths.faq, icon: CircleHelp, title: 'Perguntas frequentes', text: 'Respostas rápidas às dúvidas mais comuns.' },
  { to: paths.requestAccess('clinica'), icon: Building2, title: 'Sou uma clínica', text: 'Peça acesso ao portal da clínica.' },
  { to: paths.requestAccess('seguradora'), icon: ShieldCheck, title: 'Sou uma seguradora', text: 'Peça acesso ao portal da seguradora.' },
]

/**
 * Contacto. Sem endpoint dedicado (exigiria change control em docs/): a mensagem segue por e-mail
 * para a equipa, compondo o texto no programa de e-mail de quem escreve.
 */
export function ContactPage() {
  usePageTitle('Contacto')
  const [sent, setSent] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  function onSubmit(values: FormValues) {
    const body = [`Nome: ${values.name}`, `E-mail: ${values.email}`, '', values.message].join('\n')
    const href = mailto(`${values.subject} - ${values.name}`, body)
    setSent(href)
    window.location.href = href
  }

  return (
    <>
      <section className="relative isolate flex min-h-[26rem] items-end overflow-hidden text-white">
        <HeroMedia images={[{ src: '/images/site/recepcao.webp' }, { src: '/images/site/consulta.webp' }]} />
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-black/80 via-black/45 to-black/25" />
        <div className="mx-auto w-full max-w-7xl animate-rise px-5 pt-24 pb-14 lg:px-10 lg:pb-20">
          <p className="text-base font-semibold tracking-wide uppercase">Contacto</p>
          <h1 className="mt-4 max-w-3xl text-4xl leading-[1.08] font-bold tracking-tight text-balance md:text-6xl">
            Fale com a nossa equipa.
          </h1>
          <p className="mt-5 max-w-2xl text-xl md:text-2xl">Apoio, dúvidas ou interesse em ligar a sua clínica ou seguradora.</p>
        </div>
      </section>

      <section className="bg-surface">
        <div className="mx-auto grid max-w-7xl gap-16 px-5 py-20 lg:grid-cols-[1fr_1.2fr] lg:gap-24 lg:px-10 lg:py-28">
          <Reveal className="flex flex-col gap-8">
            <div>
              <h2 className="text-3xl leading-tight font-bold tracking-tight md:text-4xl">Escreva-nos</h2>
              <p className="mt-3 text-lg text-muted">Respondemos por e-mail assim que possível.</p>
            </div>
            <a
              href={mailto('Contacto Vita Family', '')}
              className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-6 shadow-card transition-shadow hover:shadow-overlay"
            >
              <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                <Mail className="size-7" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold tracking-wide text-muted uppercase">E-mail</span>
                <span className="block text-xl font-semibold break-words text-primary">{site.contactEmail}</span>
              </span>
            </a>
            <p className="text-base text-muted">
              O Vita Family é operado por {site.operator}. Nunca envie palavras-passe nem dados de saúde por e-mail; para
              apoio sobre uma conta, indique apenas o e-mail registado.
            </p>
          </Reveal>

          <Reveal delay={120}>
            {sent ? (
              <div role="status" className="flex flex-col gap-4 rounded-3xl bg-primary-soft p-8 md:p-10">
                <MailCheck className="size-10 text-success" aria-hidden />
                <h2 className="text-2xl font-bold">Quase lá: confirme o envio no seu e-mail.</h2>
                <p className="text-lg text-muted">
                  Abrimos o seu programa de e-mail com a mensagem preenchida para {site.contactEmail}. Se não abriu,{' '}
                  <a href={sent} className="font-semibold text-primary hover:underline">
                    clique aqui
                  </a>
                  .
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5 rounded-3xl border border-border bg-surface p-8 shadow-card md:p-10">
                <Input label="Nome" autoComplete="name" error={errors.name?.message} {...register('name')} />
                <Input label="E-mail" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
                <Select
                  label="Assunto"
                  placeholder="Escolha um assunto"
                  options={subjects.map((value) => ({ value, label: value }))}
                  error={errors.subject?.message}
                  {...register('subject')}
                />
                <Textarea label="Mensagem" rows={5} error={errors.message?.message} {...register('message')} />
                <Button type="submit" size="lg" fullWidth className="h-14 text-base">
                  Enviar mensagem
                </Button>
              </form>
            )}
          </Reveal>
        </div>
      </section>

      <section className="bg-surface-muted">
        <div className="mx-auto max-w-7xl px-5 py-20 lg:px-10 lg:py-28">
          <Reveal>
            <h2 className="text-3xl leading-tight font-bold tracking-tight md:text-4xl">Talvez isto ajude</h2>
          </Reveal>
          <ul className="mt-10 grid gap-6 md:grid-cols-3">
            {shortcuts.map(({ to, icon: Icon, title, text }, index) => (
              <li key={title}>
                <Reveal delay={index * 100} className="h-full">
                  <Link
                    to={to}
                    className="group flex h-full flex-col gap-4 rounded-3xl bg-surface p-8 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-overlay"
                  >
                    <span className="flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                      <Icon className="size-7" aria-hidden />
                    </span>
                    <span className="flex-1">
                      <span className="block text-2xl font-bold">{title}</span>
                      <span className="mt-1 block text-lg text-muted">{text}</span>
                    </span>
                    <ArrowRight className="size-6 text-primary transition-transform group-hover:translate-x-1" aria-hidden />
                  </Link>
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  )
}
