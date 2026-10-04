import { useEffect, useRef } from 'react'
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
        'flex h-9 shrink-0 snap-start items-center gap-1 rounded-full border px-3 text-sm font-medium tabular-nums',
        isNext ? 'border-transparent bg-primary text-primary-foreground' : pillStyles[dose.status],
      )}
      aria-label={`${formatTime(dose.scheduledAt)}, ${dose.medication}${who}, ${isNext ? 'próxima toma' : doseStatus[dose.status].label}`}
    >
      {formatTime(dose.scheduledAt)}
      {Icon && <Icon className="size-3.5" aria-hidden />}
    </li>
  )
}

/**
 * Tomas de hoje (“O que tenho hoje?”): horários em pílulas, com a próxima destacada.
 * Esconde-se quando não há espaço (fit-hide), para a Home nunca ter scroll.
 */
export function TodayDoses({ doses }: { doses: TodayDose[] }) {
  const row = useRef<HTMLUListElement>(null)
  const next = doses.find((d) => d.status === 'PENDING')

  // Mostra a próxima toma: desliza a fila na horizontal (nunca a página na vertical).
  useEffect(() => {
    const list = row.current
    const pill = next && list?.querySelector<HTMLElement>(`[data-dose="${next.id}"]`)
    if (list && pill) list.scrollLeft = pill.offsetLeft - list.offsetLeft - 4
  }, [next])

  if (doses.length === 0) return null

  return (
    <section aria-labelledby="today-doses" className="fit-hide flex shrink-0 flex-col gap-2.5 rounded-xl border border-border bg-surface p-3.5 shadow-card">
      <Link to={paths.medications} className="flex items-center justify-between gap-2">
        <h2 id="today-doses" className="text-sm font-semibold">
          Hoje · Medicamentos
        </h2>
        <ChevronRight className="size-4 text-muted" aria-hidden />
      </Link>
      <ul ref={row} aria-label="Tomas de hoje" className="no-scrollbar -mx-1 flex snap-x gap-2 overflow-x-auto px-1">
        {doses.map((dose) => (
          <DosePill key={dose.id} dose={dose} isNext={dose.id === next?.id} />
        ))}
      </ul>
      <p className="truncate text-sm text-muted">
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
