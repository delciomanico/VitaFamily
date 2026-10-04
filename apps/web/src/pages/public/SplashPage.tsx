import { Logo } from '@/components/layout/Logo'
import { ButtonLink } from '@/components/ui/Button'
import { paths } from '@/routes/paths'

/** TODO(fase 2): splash real com loading e redirecionamento automático. */
export function SplashPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
      <Logo size="lg" className="flex-col" />
      {/* TBD: slogan oficial não definido na especificação. */}
      <p className="text-muted">A saúde da sua família, organizada.</p>
      <div className="flex w-full flex-col gap-2">
        <ButtonLink to={paths.home} size="lg" fullWidth>
          Abrir a aplicação
        </ButtonLink>
        <ButtonLink to={paths.onboarding} size="lg" variant="ghost" fullWidth>
          Ver onboarding
        </ButtonLink>
      </div>
    </div>
  )
}
