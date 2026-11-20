import { ClipboardList, FileText, FlaskConical, History, Pill, UserRound, type LucideIcon } from 'lucide-react'
import { Page } from '@/components/layout/Page'
import type { Tone } from '@/lib/tones'
import { ListEntry } from '@/components/app/ListEntry'
import { paths } from '@/routes/paths'

interface HubItem {
  to: string
  title: string
  description: string
  icon: LucideIcon
  tone: Tone
}

const items: HubItem[] = [
  { to: paths.healthProfile, title: 'Perfil de saúde', description: 'Dados básicos, alergias e condições', icon: UserRound, tone: 'health' },
  { to: paths.prescriptions, title: 'Receitas', description: 'Receitas ativas e anteriores', icon: FileText, tone: 'chat' },
  { to: paths.medications, title: 'Medicamentos', description: 'Medicamentos ativos e lembretes', icon: Pill, tone: 'meds' },
  { to: paths.examinations, title: 'Exames', description: 'Exames e resultados', icon: FlaskConical, tone: 'brand' },
  { to: paths.medicalHistory, title: 'Histórico médico', description: 'Consultas, exames e receitas anteriores', icon: History, tone: 'brand' },
  { to: paths.preventiveReport, title: 'Relatório', description: 'Resumo preventivo', icon: ClipboardList, tone: 'family' },
]

export function HealthHubPage() {
  return (
    <Page title="Minha saúde" backTo={paths.home} backLabel="Início">
      <ul className="flex flex-col gap-3">
        {items.map(({ to, title, description, icon, tone }) => (
          <li key={to}>
            <ListEntry to={to} icon={icon} title={title} subtitle={description} tone={tone} />
          </li>
        ))}
      </ul>
    </Page>
  )
}
