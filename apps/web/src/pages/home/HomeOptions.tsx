import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bell,
  CalendarDays,
  CalendarPlus,
  ClipboardList,
  FilePlus2,
  FileText,
  FlaskConical,
  History,
  Pill,
  Ellipsis,
  Settings,
  ShieldCheck,
  TestTubeDiagonal,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { Sheet } from '@/components/app/Sheet'
import { formatCount } from '@/lib/format'
import { paths } from '@/routes/paths'
import type { HomeSummary } from '@/types/report'

interface Option {
  to: string
  label: string
  icon: LucideIcon
  /** Contador no canto do ícone (só aparece se > 0). */
  count?: number
  /** Significado do contador (singular, plural), para leitores de ecrã. */
  countLabel?: [string, string]
}

/** Opções por página: 1.ª as áreas do MVP, 2.ª as ações rápidas. */
function buildPages({ today, family }: HomeSummary, unreadAlerts: number): Option[][] {
  return [
    [
      { to: paths.appointments, label: 'Agenda', icon: CalendarDays },
      { to: paths.medications, label: 'Medicamentos', icon: Pill, count: today.pendingDoses, countLabel: ['lembrete', 'lembretes'] },
      { to: paths.prescriptions, label: 'Receitas', icon: FileText },
      { to: paths.examinations, label: 'Exames', icon: FlaskConical, count: today.newResults, countLabel: ['resultado novo', 'resultados novos'] },
      { to: paths.medicalHistory, label: 'Histórico', icon: History },
      { to: paths.family, label: 'Família', icon: Users, count: today.members, countLabel: ['membro', 'membros'] },
      { to: paths.alerts, label: 'Alertas', icon: Bell, count: unreadAlerts, countLabel: ['por ler', 'por ler'] },
      { to: paths.familyReport, label: 'Relatórios', icon: ClipboardList, count: family.withPending, countLabel: ['pendente', 'pendentes'] },
    ],
    [
      { to: paths.healthProfile, label: 'Meu perfil', icon: UserRound },
      { to: paths.appointmentNew, label: 'Marcar consulta', icon: CalendarPlus },
      { to: paths.prescriptionNew, label: 'Adicionar receita', icon: FilePlus2 },
      { to: paths.examinationNew, label: 'Adicionar exame', icon: TestTubeDiagonal },
      { to: paths.preventiveReport, label: 'Preventivo', icon: ShieldCheck },
      { to: paths.settings, label: 'Configurações', icon: Settings },
    ],
  ]
}

/** Contador máximo mostrado no ícone; acima disso aparece “9+”. */
const MAX_BADGE = 9

function OptionTile({ to, label, icon: Icon, count = 0, countLabel, onNavigate }: Option & { onNavigate: () => void }) {
  const hasCount = count > 0
  return (
    <Link
      to={to}
      onClick={onNavigate}
      aria-label={hasCount && countLabel ? `${label}, ${formatCount(count, ...countLabel)}` : label}
      className="group flex flex-col items-center gap-2 rounded-2xl p-1 text-center"
    >
      <span className="relative flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-primary transition-colors group-active:bg-primary-soft-hover">
        <Icon className="size-7" strokeWidth={1.7} aria-hidden />
        {hasCount && (
          <span
            className="absolute -top-1.5 -right-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-[#fff] px-1 text-xs font-semibold text-[#0d4f68]"
            aria-hidden
          >
            {count > MAX_BADGE ? `${MAX_BADGE}+` : count}
          </span>
        )}
      </span>
      <span className="text-sm leading-tight font-medium text-foreground" aria-hidden>
        {label}
      </span>
    </Link>
  )
}

interface HomeOptionsProps {
  summary: HomeSummary
  unreadAlerts: number
}

/** Um só botão «Mais opções»: abre uma folha com todas as outras ações (o Início fica só com o foco principal). */
export function HomeOptions({ summary, unreadAlerts }: HomeOptionsProps) {
  const options = buildPages(summary, unreadAlerts).flat()
  const [open, setOpen] = useState(false)
  const alerts = unreadAlerts
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative flex min-h-14 shrink-0 items-center justify-center gap-2 rounded-full bg-[#fff] px-6 text-lg font-semibold text-[#0d4f68] active:bg-[#eaf6fa]"
      >
        <Ellipsis className="size-6" aria-hidden />
        Mais opções
        {alerts > 0 && <span className="absolute top-2 right-5 size-3 rounded-full bg-danger" aria-hidden />}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Mais opções">
        <ul className="grid grid-cols-3 gap-x-2 gap-y-4 pb-2">
          {options.map((option) => (
            <li key={option.to}>
              <OptionTile {...option} onNavigate={() => setOpen(false)} />
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  )
}
