import { Link } from 'react-router-dom'
import {
  Bell,
  CalendarDays,
  ClipboardList,
  FileText,
  FlaskConical,
  History,
  Pill,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { formatCount } from '@/lib/format'
import { paths } from '@/routes/paths'
import type { HomeSummary } from '@/types/report'

interface GridItem {
  to: string
  label: string
  icon: LucideIcon
  /** Resumo curto de hoje (ex.: “2 lembretes”). */
  caption?: string
}

function buildItems({ today }: HomeSummary, unreadAlerts: number): GridItem[] {
  return [
    { to: paths.appointments, label: 'Agenda', icon: CalendarDays },
    {
      to: paths.medications,
      label: 'Medicamentos',
      icon: Pill,
      caption: today.pendingDoses > 0 ? formatCount(today.pendingDoses, 'lembrete', 'lembretes') : undefined,
    },
    { to: paths.prescriptions, label: 'Receitas', icon: FileText },
    {
      to: paths.examinations,
      label: 'Exames',
      icon: FlaskConical,
      caption: today.newResults > 0 ? formatCount(today.newResults, 'novo', 'novos') : undefined,
    },
    { to: paths.medicalHistory, label: 'Histórico', icon: History },
    { to: paths.family, label: 'Família', icon: Users, caption: formatCount(today.members, 'membro', 'membros') },
    {
      to: paths.alerts,
      label: 'Alertas',
      icon: Bell,
      caption: unreadAlerts > 0 ? `${unreadAlerts} por ler` : undefined,
    },
    { to: paths.familyReport, label: 'Relatórios', icon: ClipboardList },
  ]
}

interface HomeGridProps {
  summary: HomeSummary
  unreadAlerts: number
}

/** Grelha de acesso às áreas do MVP, com o resumo de hoje por baixo de cada uma. */
export function HomeGrid({ summary, unreadAlerts }: HomeGridProps) {
  return (
    <nav aria-label="Áreas">
      <ul className="grid grid-cols-4 gap-x-2 gap-y-5">
        {buildItems(summary, unreadAlerts).map(({ to, label, icon: Icon, caption }) => (
          <li key={to}>
            <Link to={to} className="group flex flex-col items-center gap-2 rounded-xl p-1 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <Icon className="size-7" strokeWidth={1.6} aria-hidden />
              </span>
              <span className="flex flex-col">
                <span className="text-xs font-medium text-foreground">{label}</span>
                {caption && <span className="text-xs text-primary">{caption}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
