import { useEffect, useRef } from 'react'
import { cn } from '@/lib/cn'
import { todayISO } from '@/lib/date'

/** Abreviaturas fixas: o `short` do Intl em pt-PT devolve “quinta-feira”/“quinta”, largo de mais. */
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const longFormat = new Intl.DateTimeFormat('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' })

/** Os próximos `count` dias a partir de hoje (yyyy-mm-dd). */
export function nextDays(count: number, now: Date = new Date()): string[] {
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(now)
    date.setDate(date.getDate() + i)
    return todayISO(date)
  })
}

function parts(day: string) {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  const value = new Date(year, month - 1, date)
  return {
    weekday: WEEKDAYS[value.getDay()] ?? '',
    date: String(date),
    long: longFormat.format(value),
  }
}

interface DateStripProps {
  days: string[]
  value: string | null
  onChange: (day: string | null) => void
  /** Dias com consultas (ponto por baixo do número). */
  marked?: Set<string>
  label: string
  /** Tocar no dia escolhido volta a mostrar todos (filtro da agenda). */
  allowClear?: boolean
}

/** Calendário em tira: dias da semana deslizáveis, com o escolhido destacado. */
export function DateStrip({ days, value, onChange, marked, label, allowClear = false }: DateStripProps) {
  const list = useRef<HTMLDivElement>(null)

  // Mantém o dia escolhido visível (só desliza se estiver fora da vista).
  useEffect(() => {
    const selected = value ? list.current?.querySelector<HTMLElement>(`[data-day="${value}"]`) : null
    selected?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [value])

  return (
    <div
      ref={list}
      role="radiogroup"
      aria-label={label}
      className="no-scrollbar -mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 py-1 lg:-mx-1 lg:scroll-px-1 lg:px-1"
    >
      {days.map((day) => {
        const { weekday, date, long } = parts(day)
        const selected = day === value
        const today = day === todayISO()
        return (
          <button
            key={day}
            type="button"
            role="radio"
            data-day={day}
            aria-checked={selected}
            aria-label={`${long}${today ? ', hoje' : ''}${marked?.has(day) ? ', com consultas' : ''}`}
            onClick={() => onChange(selected && allowClear ? null : day)}
            className={cn(
              'flex w-13 shrink-0 snap-start flex-col items-center gap-0.5 rounded-2xl border py-2 transition-colors',
              selected
                ? 'border-transparent bg-primary text-primary-foreground shadow-button'
                : 'border-border bg-surface hover:border-border-strong',
            )}
          >
            <span className={cn('text-xs', selected ? 'text-primary-foreground' : 'text-muted')}>
              {today ? 'Hoje' : weekday}
            </span>
            <span className="text-lg leading-tight font-semibold tabular-nums">{date}</span>
            <span
              className={cn(
                'size-1.5 rounded-full',
                marked?.has(day) ? (selected ? 'bg-primary-foreground' : 'bg-primary') : 'bg-transparent',
              )}
              aria-hidden
            />
          </button>
        )
      })}
    </div>
  )
}

interface TimeSlotsProps {
  times: readonly string[]
  value: string | null
  onChange: (time: string) => void
  label: string
  /** Horários que já não se podem escolher (ex.: já passaram hoje). */
  disabled?: (time: string) => boolean
}

/** Horários em pílula (09:00, 09:30…), como escolha única. */
export function TimeSlots({ times, value, onChange, label, disabled }: TimeSlotsProps) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-4 gap-2 sm:grid-cols-6">
      {times.map((time) => {
        const selected = time === value
        const off = disabled?.(time) ?? false
        return (
          <button
            key={time}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={off}
            onClick={() => onChange(time)}
            className={cn(
              'h-10 rounded-full border text-sm font-medium tabular-nums transition-colors disabled:opacity-35',
              selected
                ? 'border-transparent bg-primary text-primary-foreground'
                : 'border-border bg-surface hover:border-border-strong',
            )}
          >
            {time}
          </button>
        )
      })}
    </div>
  )
}
