import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bell,
  CalendarDays,
  CalendarPlus,
  ClipboardList,
  Ellipsis,
  FilePlus2,
  FileText,
  FlaskConical,
  History,
  Pill,
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

/** Os 4 atalhos mais usados ficam no Início; o resto está na folha «Mais». */
function buildOptions({ today, family }: HomeSummary, unreadAlerts: number): { main: Option[]; more: Option[] } {
  return {
    main: [
      { to: paths.medications, label: 'Medicamentos', icon: Pill, count: today.pendingDoses, countLabel: ['lembrete', 'lembretes'] },
      { to: paths.examinations, label: 'Exames', icon: FlaskConical, count: today.newResults, countLabel: ['resultado novo', 'resultados novos'] },
      { to: paths.prescriptions, label: 'Receitas', icon: FileText },
      { to: paths.family, label: 'Família', icon: Users, count: today.members, countLabel: ['membro', 'membros'] },
    ],
    more: [
      { to: paths.appointments, label: 'Agenda', icon: CalendarDays },
      { to: paths.appointmentNew, label: 'Marcar consulta', icon: CalendarPlus },
      { to: paths.prescriptionNew, label: 'Adicionar receita', icon: FilePlus2 },
      { to: paths.examinationNew, label: 'Adicionar exame', icon: TestTubeDiagonal },
      { to: paths.medicalHistory, label: 'Histórico', icon: History },
      { to: paths.alerts, label: 'Alertas', icon: Bell, count: unreadAlerts, countLabel: ['por ler', 'por ler'] },
      { to: paths.familyReport, label: 'Relatórios', icon: ClipboardList, count: family.withPending, countLabel: ['pendente', 'pendentes'] },
      { to: paths.preventiveReport, label: 'Preventivo', icon: ShieldCheck },
      { to: paths.healthProfile, label: 'Meu perfil de saúde', icon: UserRound },
    ],
  }
}

/** Contador máximo mostrado no ícone; acima disso aparece «9+». */
const MAX_BADGE = 9

function Tile({ to, label, icon: Icon, count = 0, countLabel, onNavigate }: Option & { onNavigate?: () => void }) {
  const hasCount = count > 0
  return (
    <Link
      to={to}
      onClick={onNavigate}
      aria-label={hasCount && countLabel ? `${label}, ${formatCount(count, ...countLabel)}` : label}
      className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-surface p-3 text-center shadow-card transition-colors active:bg-surface-muted"
    >
      <span className="relative flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
        <Icon className="size-7" strokeWidth={1.8} aria-hidden />
        {hasCount && (
          <span
            className="absolute -top-1.5 -right-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1 text-sm font-semibold text-primary-foreground ring-2 ring-surface"
            aria-hidden
          >
            {count > MAX_BADGE ? `${MAX_BADGE}+` : count}
          </span>
        )}
      </span>
      <span className="text-base leading-tight font-semibold" aria-hidden>
        {label}
      </span>
    </Link>
  )
}

interface HomeOptionsProps {
  summary: HomeSummary
  unreadAlerts: number
}

/** Atalhos do Início: 4 grandes e um botão «Mais», que abre o resto numa folha. */
export function HomeOptions({ summary, unreadAlerts }: HomeOptionsProps) {
  const { main, more } = buildOptions(summary, unreadAlerts)
  const [open, setOpen] = useState(false)

  return (
    <section aria-labelledby="home-shortcuts" className="flex flex-col gap-3">
      <h2 id="home-shortcuts" className="text-lg font-semibold">
        Os seus atalhos
      </h2>
      <ul className="grid grid-cols-2 gap-3">
        {main.map((option) => (
          <li key={option.to}>
            <Tile {...option} />
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-14 items-center justify-center gap-2 rounded-full border border-border-strong bg-surface px-6 text-lg font-semibold text-primary active:bg-surface-muted"
      >
        <Ellipsis className="size-6" aria-hidden />
        Mais opções
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Mais opções">
        <ul className="grid grid-cols-2 gap-3">
          {more.map((option) => (
            <li key={option.to}>
              <Tile {...option} onNavigate={() => setOpen(false)} />
            </li>
          ))}
        </ul>
      </Sheet>
    </section>
  )
}
