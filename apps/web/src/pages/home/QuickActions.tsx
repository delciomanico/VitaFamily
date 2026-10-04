import { Link } from 'react-router-dom'
import { CalendarPlus, FilePlus2, FlaskConical, Pill, type LucideIcon } from 'lucide-react'
import { Section } from '@/components/ui/Card'
import { paths } from '@/routes/paths'

interface QuickAction {
  to: string
  label: string
  icon: LucideIcon
}

const actions: QuickAction[] = [
  { to: paths.appointmentNew, label: 'Marcar consulta', icon: CalendarPlus },
  { to: paths.prescriptionNew, label: 'Adicionar receita', icon: FilePlus2 },
  { to: paths.examinationNew, label: 'Adicionar exame', icon: FlaskConical },
  { to: paths.medications, label: 'Medicamentos', icon: Pill },
]

export function QuickActions() {
  return (
    <Section title="Acesso rápido">
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {actions.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <Link
              to={to}
              className="flex h-full flex-col gap-3 rounded-lg border border-border bg-surface p-4 text-sm font-medium shadow-card transition-colors hover:border-border-strong active:bg-surface-muted"
            >
              <Icon className="size-5 text-primary" aria-hidden />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  )
}
