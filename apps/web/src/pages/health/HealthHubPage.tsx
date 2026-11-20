import { ClipboardList, FileText, FlaskConical, History, Pill, UserRound, type LucideIcon } from 'lucide-react'
import { Page } from '@/components/layout/Page'
import { ListEntry } from '@/components/app/ListEntry'
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
      <ul className="flex flex-col gap-3">
        {items.map(({ to, title, description, icon }) => (
          <li key={to}>
            <ListEntry to={to} icon={icon} title={title} subtitle={description} />
          </li>
        ))}
      </ul>
    </Page>
  )
}
