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
import { cn } from '@/lib/cn'
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

function OptionTile({ to, label, icon: Icon, count = 0, countLabel, onNavigate, compact = false }: Option & { onNavigate?: () => void; compact?: boolean }) {
  const hasCount = count > 0
  return (
    <Link
      to={to}
      onClick={onNavigate}
      aria-label={hasCount && countLabel ? `${label}, ${formatCount(count, ...countLabel)}` : label}
      className="group flex flex-col items-center gap-2 rounded-2xl p-1 text-center"
    >
      <span className={cn('relative flex items-center justify-center rounded-2xl bg-primary-soft text-primary transition-colors group-active:bg-primary-soft-hover', compact ? 'size-12' : 'size-14')}>
        <Icon className={compact ? 'size-6' : 'size-7'} strokeWidth={1.7} aria-hidden />
        {hasCount && (
          <span
            className="absolute -top-1.5 -right-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-foreground ring-2 ring-background"
            aria-hidden
          >
            {count > MAX_BADGE ? `${MAX_BADGE}+` : count}
          </span>
        )}
      </span>
      <span className={cn('leading-tight font-medium text-foreground', compact ? 'text-xs' : 'text-sm')} aria-hidden>
        {label}
      </span>
    </Link>
  )
}

interface HomeOptionsProps {
  summary: HomeSummary
  unreadAlerts: number
}

/** Quatro opções principais e, por baixo, «Mais opções»: abre uma folha com todas as outras. */
export function HomeOptions({ summary, unreadAlerts }: HomeOptionsProps) {
  const all = buildPages(summary, unreadAlerts).flat()
  const main = all.slice(0, 4)
  const more = all.slice(4)
  const [open, setOpen] = useState(false)
  return (
    <div className="flex shrink-0 flex-col gap-3 pt-1">
      <ul className="grid grid-cols-4 gap-x-1">
        {main.map((option) => (
          <li key={option.to}>
            <OptionTile {...option} compact />
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary px-6 text-base font-semibold text-primary-foreground shadow-button active:bg-primary-hover"
      >
        <Ellipsis className="size-5" aria-hidden />
        Mais opções
        {unreadAlerts > 0 && <span className="absolute top-1.5 right-5 size-3 rounded-full bg-danger" aria-hidden />}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Mais opções">
        <ul className="grid grid-cols-3 gap-x-2 gap-y-4 pb-2">
          {more.map((option) => (
            <li key={option.to}>
              <OptionTile {...option} onNavigate={() => setOpen(false)} />
            </li>
          ))}
        </ul>
      </Sheet>
    </div>
  )
}
