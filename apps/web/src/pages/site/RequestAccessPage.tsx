import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { MailCheck } from 'lucide-react'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { usePageTitle } from '@/hooks/usePageTitle'
import { mailto, site } from '@/lib/site'
import { paths } from '@/routes/paths'

const kinds = {
  clinica: {
    entity: 'Clínica',
    title: 'Solicitar acesso para a sua clínica',
    lead: 'As contas do portal da clínica são criadas pela equipa Vita Family depois de validarmos a clínica.',
    login: paths.clinicLogin,
  },
} as const

const schema = z.object({
  entityName: z.string().trim().min(2, 'Indique o nome da entidade.').max(120),
  contactName: z.string().trim().min(2, 'Indique o nome do responsável.').max(120),
  email: z.email('Introduza um e-mail válido.'),
  phone: z.string().trim().max(30).optional(),
  message: z.string().trim().max(600).optional(),
})
type FormValues = z.infer<typeof schema>

/**
 * Pedido de acesso de clínicas. Sem endpoint dedicado ainda (a fila de pedidos
 * exige change control em docs/): o pedido segue por e-mail para a equipa, que cria a conta
 * (as contas do portal são sempre criadas pelo Platform Admin, ADR-020).
 */
export function RequestAccessPage() {
  const { kind } = useParams()
  const config = kind === 'clinica' ? kinds[kind] : null
  usePageTitle(config ? 'Solicitar acesso' : undefined)
  const [sent, setSent] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  if (!config) return <Navigate to={paths.enter} replace />

  function onSubmit(values: FormValues) {
    const body = [
      `Tipo de entidade: ${config!.entity}`,
      `Entidade: ${values.entityName}`,
      `Responsável: ${values.contactName}`,
      `E-mail: ${values.email}`,
      values.phone ? `Telefone: ${values.phone}` : null,
      values.message ? `\nMensagem:\n${values.message}` : null,
    ]
      .filter(Boolean)
      .join('\n')
    const href = mailto(`Pedido de acesso - ${config!.entity} - ${values.entityName}`, body)
    setSent(href)
    window.location.href = href
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-16 lg:py-24">
      <h1 className="text-4xl leading-tight font-bold tracking-tight md:text-5xl">{config.title}</h1>
      <p className="mt-2 text-muted">{config.lead}</p>

      {sent ? (
        <div role="status" className="mt-8 flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
          <MailCheck className="size-7 text-success" aria-hidden />
          <p className="font-semibold">Quase lá: confirme o envio no seu e-mail.</p>
          <p className="text-sm text-muted">
            Abrimos o seu programa de e-mail com o pedido preenchido para {site.contactEmail}. Se não abriu,{' '}
            <a href={sent} className="font-semibold text-primary hover:underline">
              clique aqui
            </a>
            . Respondemos assim que validarmos os dados.
          </p>
          <Link to={config.login} className="text-sm font-semibold text-primary hover:underline">
            Já tem conta? Entrar
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-8 flex flex-col gap-4">
          <Input label={`Nome da ${config.entity.toLowerCase()}`} autoComplete="organization" error={errors.entityName?.message} {...register('entityName')} />
          <Input label="Nome do responsável" autoComplete="name" error={errors.contactName?.message} {...register('contactName')} />
          <Input label="E-mail profissional" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
          <Input label="Telefone (opcional)" type="tel" autoComplete="tel" error={errors.phone?.message} {...register('phone')} />
          <Textarea label="Mensagem (opcional)" rows={4} error={errors.message?.message} {...register('message')} />
          <Button type="submit" size="lg" fullWidth>
            Enviar pedido
          </Button>
          <p className="text-center text-sm text-muted">
            Já tem conta?{' '}
            <Link to={config.login} className="font-semibold text-primary hover:underline">
              Entrar
            </Link>
          </p>
        </form>
      )}
    </div>
  )
}
