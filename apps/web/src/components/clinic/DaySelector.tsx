import { DateStrip } from '@/components/domain/DatePickers'
import { cn } from '@/lib/cn'
import { todayISO } from '@/lib/date'
import { useIsDesktop } from '@/hooks/useIsDesktop'

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const monthFormat = new Intl.DateTimeFormat('pt-PT', { month: 'long' })

function parse(day: string) {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  return new Date(year, month - 1, date)
}

interface DaySelectorProps {
  days: string[]
  value: string | null
  onChange: (day: string | null) => void
  marked?: Set<string>
  label: string
  allowClear?: boolean
}

/**
 * Escolha do dia: tira deslizante no telemóvel, calendário em grelha (7 colunas, semanas
 * alinhadas) no desktop. Mostra só uma das duas, para não duplicar controlos acessíveis.
 */
export function DaySelector({ days, value, onChange, marked, label, allowClear = false }: DaySelectorProps) {
  const desktop = useIsDesktop()
  if (!desktop) {
    return <DateStrip days={days} value={value} onChange={onChange} marked={marked} label={label} allowClear={allowClear} />
  }
  const first = days[0] ? parse(days[0]) : new Date()
  const today = todayISO()
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
      <p className="text-sm font-semibold text-muted capitalize">{monthFormat.format(first)}</p>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((weekday) => (
          <span key={weekday} aria-hidden className="pb-1 text-center text-xs text-muted">
            {weekday}
          </span>
        ))}
        {Array.from({ length: first.getDay() }, (_, i) => (
          <span key={`gap-${i}`} aria-hidden />
        ))}
        {days.map((day) => {
          const selected = day === value
          const date = parse(day)
          return (
            <button
              key={day}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${date.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' })}${
                day === today ? ', hoje' : ''
              }${marked?.has(day) ? ', com marcações' : ''}`}
              onClick={() => onChange(selected && allowClear ? null : day)}
              className={cn(
                'flex aspect-square flex-col items-center justify-center rounded-xl border text-sm font-semibold tabular-nums transition-colors',
                selected
                  ? 'border-transparent bg-primary text-primary-foreground'
                  : day === today
                    ? 'border-primary bg-surface'
                    : 'border-transparent hover:bg-surface-muted',
              )}
            >
              {date.getDate()}
              <span
                className={cn(
                  'mt-0.5 size-1.5 rounded-full',
                  marked?.has(day) ? (selected ? 'bg-primary-foreground' : 'bg-primary') : 'bg-transparent',
                )}
                aria-hidden
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
