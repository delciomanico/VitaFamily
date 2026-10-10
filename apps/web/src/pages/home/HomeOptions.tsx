import { useRef, useState } from 'react'
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
  Settings,
  ShieldCheck,
  TestTubeDiagonal,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react'
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

function OptionTile({ to, label, icon: Icon, count = 0, countLabel }: Option) {
  const hasCount = count > 0
  return (
    <Link
      to={to}
      aria-label={hasCount && countLabel ? `${label}, ${formatCount(count, ...countLabel)}` : label}
      className="group flex flex-col items-center gap-1.5 rounded-xl p-1 text-center"
    >
      <span className="relative flex size-12 items-center justify-center rounded-xl bg-primary-soft text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
        <Icon className="size-6" strokeWidth={1.7} aria-hidden />
        {hasCount && (
          <span
            className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[0.6875rem] font-semibold text-primary-foreground ring-2 ring-background"
            aria-hidden
          >
            {count > MAX_BADGE ? `${MAX_BADGE}+` : count}
          </span>
        )}
      </span>
      <span className="text-xs leading-tight font-medium text-foreground" aria-hidden>
        {label}
      </span>
    </Link>
  )
}

interface HomeOptionsProps {
  summary: HomeSummary
  unreadAlerts: number
}

/** Menu de opções da Home: páginas que deslizam na horizontal, com pontos de página. */
export function HomeOptions({ summary, unreadAlerts }: HomeOptionsProps) {
  const pages = buildPages(summary, unreadAlerts)
  const track = useRef<HTMLDivElement>(null)
  const [current, setCurrent] = useState(0)

  function onScroll() {
    const el = track.current
    if (el) setCurrent(Math.round(el.scrollLeft / el.clientWidth))
  }

  function goTo(index: number) {
    const el = track.current
    el?.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' })
  }

  return (
    <nav aria-label="Opções" aria-roledescription="carrossel" className="flex shrink-0 flex-col gap-1 pt-3">
      <div
        ref={track}
        onScroll={onScroll}
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain pt-2"
      >
        {pages.map((options, index) => (
          <ul
            key={index}
            aria-label={`Página ${index + 1} de ${pages.length}`}
            className="grid w-full shrink-0 snap-start grid-cols-4 content-start gap-x-1 gap-y-1"
          >
            {options.map((option) => (
              <li key={option.to}>
                <OptionTile {...option} />
              </li>
            ))}
          </ul>
        ))}
      </div>
      <div className="flex justify-center gap-1">
        {pages.map((_, index) => (
          <button
            key={index}
            type="button"
            onClick={() => goTo(index)}
            aria-label={`Ver página ${index + 1} de opções`}
            aria-current={index === current ? 'true' : undefined}
            className="flex size-6 items-center justify-center"
          >
            <span
              className={cn('h-2 rounded-full transition-all', index === current ? 'w-6 bg-primary' : 'w-2 bg-border-strong')}
            />
          </button>
        ))}
      </div>
    </nav>
  )
}
