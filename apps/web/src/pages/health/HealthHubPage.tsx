import { ClipboardList, FileText, FlaskConical, History, Pill, UserRound, type LucideIcon } from 'lucide-react'
import { Page } from '@/components/layout/Page'
import { CardLink } from '@/components/ui/Card'
import { paths } from '@/routes/paths'

interface HubItem {
  to: string
  title: string
  description: string
  icon: LucideIcon
}

const items: HubItem[] = [
  { to: paths.healthProfile, title: 'Perfil de saúde', description: 'Dados básicos, alergias e condições', icon: UserRound },
  { to: paths.prescriptions, title: 'Receitas', description: 'Receitas ativas e anteriores', icon: FileText },
  { to: paths.medications, title: 'Medicamentos', description: 'Medicamentos ativos e lembretes', icon: Pill },
  { to: paths.examinations, title: 'Exames', description: 'Exames e resultados', icon: FlaskConical },
  { to: paths.medicalHistory, title: 'Histórico médico', description: 'Consultas, exames e receitas anteriores', icon: History },
  { to: paths.preventiveReport, title: 'Relatório', description: 'Resumo preventivo', icon: ClipboardList },
]

export function HealthHubPage() {
  return (
    <Page title="Minha saúde" backTo={paths.home} backLabel="Início">
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map(({ to, title, description, icon: Icon }) => (
          <li key={to}>
            <CardLink to={to} className="h-full">
              <div className="flex items-center gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block font-medium">{title}</span>
                  <span className="block text-sm text-muted">{description}</span>
                </span>
              </div>
            </CardLink>
          </li>
        ))}
      </ul>
    </Page>
  )
}
