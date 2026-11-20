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
import { cn } from '@/lib/cn'
import { toneBadge, toneBlock, type Tone } from '@/lib/tones'
import { formatCount } from '@/lib/format'
import { paths } from '@/routes/paths'
import type { HomeSummary } from '@/types/report'

interface Option {
  to: string
  label: string
  icon: LucideIcon
  tone: Tone
  /** Contador no canto do ícone (só aparece se > 0). */
  count?: number
  /** Significado do contador (singular, plural), para leitores de ecrã. */
  countLabel?: [string, string]
}

/** Os 4 atalhos mais usados ficam no Início; o resto está na folha «Mais». */
function buildOptions({ today, family }: HomeSummary, unreadAlerts: number): { main: Option[]; more: Option[] } {
  return {
    main: [
      { to: paths.medications, label: 'Medicamentos', icon: Pill, tone: 'meds', count: today.pendingDoses, countLabel: ['lembrete', 'lembretes'] },
      { to: paths.examinations, label: 'Exames', icon: FlaskConical, tone: 'brand', count: today.newResults, countLabel: ['resultado novo', 'resultados novos'] },
      { to: paths.prescriptions, label: 'Receitas', icon: FileText, tone: 'chat' },
      { to: paths.family, label: 'Família', icon: Users, tone: 'family', count: today.members, countLabel: ['membro', 'membros'] },
    ],
    more: [
      { to: paths.appointments, label: 'Agenda', icon: CalendarDays, tone: 'brand' },
      { to: paths.appointmentNew, label: 'Marcar consulta', icon: CalendarPlus, tone: 'brand' },
      { to: paths.prescriptionNew, label: 'Adicionar receita', icon: FilePlus2, tone: 'chat' },
      { to: paths.examinationNew, label: 'Adicionar exame', icon: TestTubeDiagonal, tone: 'brand' },
      { to: paths.medicalHistory, label: 'Histórico', icon: History, tone: 'health' },
      { to: paths.alerts, label: 'Alertas', icon: Bell, tone: 'chat', count: unreadAlerts, countLabel: ['por ler', 'por ler'] },
      { to: paths.familyReport, label: 'Relatórios', icon: ClipboardList, tone: 'family', count: family.withPending, countLabel: ['pendente', 'pendentes'] },
      { to: paths.preventiveReport, label: 'Preventivo', icon: ShieldCheck, tone: 'family' },
      { to: paths.healthProfile, label: 'Meu perfil de saúde', icon: UserRound, tone: 'health' },
    ],
  }
}

/** Contador máximo mostrado no ícone; acima disso aparece «9+». */
const MAX_BADGE = 9

function Tile({ to, label, icon: Icon, tone, count = 0, countLabel, onNavigate }: Option & { onNavigate?: () => void }) {
  const hasCount = count > 0
  return (
    <Link
      to={to}
      onClick={onNavigate}
      aria-label={hasCount && countLabel ? `${label}, ${formatCount(count, ...countLabel)}` : label}
      className={cn('flex min-h-32 flex-col justify-between gap-4 rounded-[1.25rem] p-4 transition-transform active:scale-[0.97]', toneBlock[tone])}
    >
      <span className="flex items-start justify-between">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-white/80">
          <Icon className="size-7" strokeWidth={1.9} aria-hidden />
        </span>
        {hasCount && (
          <span className={cn('flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-base font-bold text-white', toneBadge[tone])} aria-hidden>
            {count > MAX_BADGE ? `${MAX_BADGE}+` : count}
          </span>
        )}
      </span>
      <span className="font-display text-xl leading-tight font-bold text-foreground" aria-hidden>
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
      <h2 id="home-shortcuts" className="font-display text-xl font-bold">
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
        className="flex min-h-14 items-center justify-center gap-2 rounded-full border-2 border-primary/25 bg-transparent px-6 text-lg font-semibold text-primary active:bg-primary-soft"
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
