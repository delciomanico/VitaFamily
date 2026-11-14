import { Mail } from 'lucide-react'
import { ButtonLink } from '@/components/ui/Button'
import { usePageTitle } from '@/hooks/usePageTitle'
import { mailto, site } from '@/lib/site'
import { paths } from '@/routes/paths'

export function ContactPage() {
  usePageTitle('Contacto')
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 lg:py-24">
      <h1 className="text-4xl leading-tight font-bold tracking-tight md:text-5xl">Contacto</h1>
      <p className="mt-2 text-muted">Dúvidas, apoio ou interesse em ligar a sua clínica ou seguradora? Fale connosco.</p>
      <div className="mt-8 flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center gap-3">
          <Mail className="size-5 text-primary" aria-hidden />
          <a href={mailto('Contacto Vita Family', '')} className="font-semibold text-primary hover:underline">
            {site.contactEmail}
          </a>
        </div>
        <p className="text-sm text-muted">
          O Vita Family é operado por {site.operator}. Para apoio sobre uma conta, indique sempre o e-mail registado
          e nunca envie palavras-passe nem dados de saúde por e-mail.
        </p>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <ButtonLink to={paths.requestAccess('clinica')} variant="secondary">
          Sou uma clínica
        </ButtonLink>
        <ButtonLink to={paths.requestAccess('seguradora')} variant="secondary">
          Sou uma seguradora
        </ButtonLink>
      </div>
    </div>
  )
}
