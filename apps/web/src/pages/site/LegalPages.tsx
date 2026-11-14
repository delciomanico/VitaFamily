import { usePageTitle } from '@/hooks/usePageTitle'
import { PrivacyContent, TermsContent } from './legal'

function LegalShell({ title, children }: { title: string; children: React.ReactNode }) {
  usePageTitle(title)
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 lg:py-16">
      <h1 className="mb-6 text-[1.75rem] leading-tight font-bold tracking-tight">{title}</h1>
      {children}
    </div>
  )
}

export function TermsPublicPage() {
  return (
    <LegalShell title="Termos de utilização">
      <TermsContent />
    </LegalShell>
  )
}

export function PrivacyPublicPage() {
  return (
    <LegalShell title="Política de privacidade">
      <PrivacyContent />
    </LegalShell>
  )
}
