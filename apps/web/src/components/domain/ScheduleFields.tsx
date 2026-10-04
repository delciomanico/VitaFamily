import { useId } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { controlClasses, controlState } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { cn } from '@/lib/cn'
import { INTERVAL_HOURS, dailyTimes, intervalTimes, localTime } from '@/lib/medication'
import type { MedicationPlan } from '@/types/medication'
import type { ScheduleInput } from '@/services/prescription.service'

/** Valor do formulário de horários (BR-MED-01): horas fixas ou “de X em X horas”. */
export interface ScheduleValue {
  scheduleType: 'FIXED_TIMES' | 'INTERVAL'
  times: string[]
  intervalHours: string
  firstTime: string
}

export const emptySchedule = (): ScheduleValue => ({
  scheduleType: 'FIXED_TIMES',
  times: ['08:00'],
  intervalHours: '8',
  firstTime: '08:00',
})

export function scheduleFromPlan(plan: MedicationPlan): ScheduleValue {
  return plan.scheduleType === 'INTERVAL'
    ? {
        ...emptySchedule(),
        scheduleType: 'INTERVAL',
        intervalHours: String(plan.intervalHours ?? 8),
        firstTime: localTime(plan.startAt),
      }
    : { ...emptySchedule(), times: dailyTimes(plan) }
}

/** Mensagem de erro, ou null se o horário for válido. */
export function scheduleError(value: ScheduleValue): string | null {
  if (value.scheduleType === 'INTERVAL') return value.firstTime ? null : 'Indique a hora da primeira toma.'
  const filled = value.times.filter(Boolean)
  if (filled.length === 0) return 'Indique pelo menos um horário.'
  if (filled.length !== value.times.length) return 'Preencha ou remova os horários vazios.'
  if (new Set(filled).size !== filled.length) return 'Há horários repetidos.'
  return null
}

export function toScheduleInput(value: ScheduleValue): ScheduleInput {
  return value.scheduleType === 'INTERVAL'
    ? { scheduleType: 'INTERVAL', intervalHours: Number(value.intervalHours), firstTime: value.firstTime }
    : { scheduleType: 'FIXED_TIMES', times: value.times }
}

const typeOptions = [
  { value: 'FIXED_TIMES', label: 'Horários fixos' },
  { value: 'INTERVAL', label: 'De X em X horas' },
]

const intervalOptions = INTERVAL_HOURS.map((hours) => ({
  value: String(hours),
  label: hours === 24 ? 'Uma vez por dia (24 h)' : `De ${hours} em ${hours} horas`,
}))

/** “07:00, 15:00 e 23:00”. */
function listTimes(times: string[]): string {
  return times.length > 1 ? `${times.slice(0, -1).join(', ')} e ${times.at(-1)}` : (times[0] ?? '')
}

interface ScheduleFieldsProps {
  value: ScheduleValue
  onChange: (value: ScheduleValue) => void
  error?: string
}

/** Frequência e horários de um medicamento. */
export function ScheduleFields({ value, onChange, error }: ScheduleFieldsProps) {
  const timesLabel = useId()
  const set = (patch: Partial<ScheduleValue>) => onChange({ ...value, ...patch })
  const setTime = (index: number, time: string) => set({ times: value.times.map((t, i) => (i === index ? time : t)) })

  return (
    <div className="flex flex-col gap-4">
      <Select
        label="Frequência"
        options={typeOptions}
        value={value.scheduleType}
        onChange={(event) => set({ scheduleType: event.target.value as ScheduleValue['scheduleType'] })}
      />

      {value.scheduleType === 'FIXED_TIMES' ? (
        <div className="flex flex-col gap-1.5" role="group" aria-labelledby={timesLabel}>
          <span id={timesLabel} className="text-sm font-medium">
            Horários
          </span>
          <ul className="flex flex-wrap gap-2">
            {value.times.map((time, index) => (
              <li key={index} className="relative">
                <input
                  type="time"
                  value={time}
                  aria-label={`Horário ${index + 1}`}
                  onChange={(event) => setTime(index, event.target.value)}
                  className={cn(
                    controlClasses,
                    controlState(error),
                    'h-11 w-34 tabular-nums',
                    value.times.length > 1 && 'pr-10',
                  )}
                />
                {value.times.length > 1 && (
                  <button
                    type="button"
                    onClick={() => set({ times: value.times.filter((_, i) => i !== index) })}
                    aria-label={`Remover horário ${index + 1}`}
                    className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-border"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                )}
              </li>
            ))}
            <li>
              <Button
                variant="soft"
                className="h-11"
                onClick={() => set({ times: [...value.times, ''] })}
                icon={<Plus className="size-4" aria-hidden />}
              >
                Horário
              </Button>
            </li>
          </ul>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Intervalo"
            options={intervalOptions}
            value={value.intervalHours}
            onChange={(event) => set({ intervalHours: event.target.value })}
          />
          <Input
            label="Primeira toma"
            type="time"
            value={value.firstTime}
            onChange={(event) => set({ firstTime: event.target.value })}
            error={error}
            hint={
              value.firstTime
                ? `Tomas às ${listTimes(intervalTimes(value.firstTime, Number(value.intervalHours)))}.`
                : undefined
            }
          />
        </div>
      )}
    </div>
  )
}
