import { CircleHelp, FileText } from 'lucide-react'
import { EmptyState } from '@/components/ui/states'
import { TERMS_VERSION } from '@/services/auth.service'
import { SettingsSubPage } from './SettingsPage'

/*
 * Ajuda, Termos e Política de privacidade: os textos ainda não existem em docs/ (BR-ACC-03 só fixa a versão).
 * Não se inventa conteúdo; as páginas ficam prontas para o receber.
 */

export function HelpPage() {
  return (
    <SettingsSubPage title="Ajuda">
      <EmptyState
        icon={CircleHelp}
        title="Em breve"
        description="A ajuda e o contacto de suporte estão em preparação."
      />
    </SettingsSubPage>
  )
}

export function TermsPage() {
  return (
    <SettingsSubPage title="Termos">
      <EmptyState
        icon={FileText}
        title={`Versão ${TERMS_VERSION}`}
        description="O texto dos termos de utilização está em preparação."
      />
    </SettingsSubPage>
  )
}

export function PrivacyPolicyPage() {
  return (
    <SettingsSubPage title="Política de privacidade">
      <EmptyState
        icon={FileText}
        title={`Versão ${TERMS_VERSION}`}
        description="O texto da política de privacidade está em preparação."
      />
    </SettingsSubPage>
  )
}
