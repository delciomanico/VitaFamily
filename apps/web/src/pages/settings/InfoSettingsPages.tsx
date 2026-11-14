import { CircleHelp } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card } from '@/components/ui/Card'
import { PrivacyContent, TermsContent } from '@/pages/site/legal'
import { site } from '@/lib/site'
import { paths } from '@/routes/paths'
import { SettingsSubPage } from './SettingsPage'

/*
 * Ajuda, Termos e Política de privacidade. Os textos legais são resumos informativos até à revisão
 * jurídica (docs/08-security/privacy.md): reutilizam o conteúdo das páginas públicas.
 */

export function HelpPage() {
  return (
    <SettingsSubPage title="Ajuda">
      <Card className="flex flex-col gap-3">
        <CircleHelp className="size-6 text-primary" aria-hidden />
        <p>
          Consulte as{' '}
          <Link to={paths.faq} className="font-semibold text-primary hover:underline">
            perguntas frequentes
          </Link>{' '}
          ou escreva-nos para{' '}
          <a href={`mailto:${site.contactEmail}`} className="font-semibold text-primary hover:underline">
            {site.contactEmail}
          </a>
          . Nunca envie palavras-passe nem dados de saúde por e-mail.
        </p>
      </Card>
    </SettingsSubPage>
  )
}

export function TermsPage() {
  return (
    <SettingsSubPage title="Termos">
      <TermsContent />
    </SettingsSubPage>
  )
}

export function PrivacyPolicyPage() {
  return (
    <SettingsSubPage title="Política de privacidade">
      <PrivacyContent />
    </SettingsSubPage>
  )
}
