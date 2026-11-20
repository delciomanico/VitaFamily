import { Link } from 'react-router-dom'
import { Check, ChevronRight, CircleAlert, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatTime } from '@/lib/format'
import { doseStatus } from '@/lib/labels'
import { paths } from '@/routes/paths'
import type { DoseStatus } from '@/types/medication'
import type { TodayDose } from '@/types/report'

const pillStyles: Record<DoseStatus, string> = {
  PENDING: 'border-border bg-surface text-foreground',
  TAKEN: 'border-transparent bg-success-soft text-success',
  NOT_TAKEN: 'border-transparent bg-surface-muted text-muted',
  UNCONFIRMED: 'border-transparent bg-warning-soft text-warning',
}

const statusIcons = { TAKEN: Check, UNCONFIRMED: CircleAlert, NOT_TAKEN: X } as const

function DosePill({ dose, isNext }: { dose: TodayDose; isNext: boolean }) {
  const Icon = dose.status === 'PENDING' ? null : statusIcons[dose.status]
  const who = dose.isSelf ? '' : `, ${dose.memberName}`
  return (
    <li
      data-dose={dose.id}
      className={cn(
        'flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-base font-semibold tabular-nums',
        isNext ? 'border-transparent bg-primary text-primary-foreground' : pillStyles[dose.status],
      )}
      aria-label={`${formatTime(dose.scheduledAt)}, ${dose.medication}${who}, ${isNext ? 'próxima toma' : doseStatus[dose.status].label}`}
    >
      {formatTime(dose.scheduledAt)}
      {Icon && <Icon className="size-4" aria-hidden />}
    </li>
  )
}

/**
 * Tomas de hoje: horários em pílulas, com a próxima destacada.
 */
export function TodayDoses({ doses }: { doses: TodayDose[] }) {
  const next = doses.find((d) => d.status === 'PENDING')
  if (doses.length === 0) return null

  return (
    <section aria-labelledby="today-doses" className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
      <Link to={paths.medications} className="flex min-h-11 items-center justify-between gap-2">
        <h2 id="today-doses" className="text-lg font-semibold">
          Hoje · Medicamentos
        </h2>
        <ChevronRight className="size-6 text-muted" aria-hidden />
      </Link>
      <ul aria-label="Tomas de hoje" className="flex flex-wrap gap-2">
        {doses.map((dose) => (
          <DosePill key={dose.id} dose={dose} isNext={dose.id === next?.id} />
        ))}
      </ul>
      <p className="text-base text-muted">
        {next ? (
          <>
            Próxima: <span className="font-medium text-foreground">{next.medication}</span> · {formatTime(next.scheduledAt)}
            {!next.isSelf && ` · ${next.memberName}`}
          </>
        ) : (
          'Sem mais tomas hoje.'
        )}
      </p>
    </section>
  )
}
