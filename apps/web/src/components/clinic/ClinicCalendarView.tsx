import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, FlaskConical } from 'lucide-react'
import { ConfirmationBadge } from '@/components/clinic/ConfirmationBadge'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Tabs } from '@/components/ui/Tabs'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useClinicAuth } from '@/contexts/ClinicAuthContext'
import { useAsync } from '@/hooks/useAsync'
import { cn } from '@/lib/cn'
import { todayISO } from '@/lib/date'
import { formatLongDate, formatTime } from '@/lib/format'
import { dayStateLabel } from '@/lib/clinicDay'
import { appointmentStatus } from '@/lib/labels'
import { paths } from '@/routes/paths'
import { clinicCatalogService } from '@/services/clinicCatalog.service'
import { clinicPatientsService } from '@/services/clinicPatients.service'
import type { ClinicCalendar, ClinicCalendarEntry, ClinicCalendarFreeSlot } from '@/types/clinic'

type Range = 'day' | 'week'

const NO_PROFESSIONAL = '__none__'
const weekdayFormat = new Intl.DateTimeFormat('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' })

const parseDay = (day: string) => {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  return new Date(year, month - 1, date)
}
const addDays = (day: string, days: number) => {
  const date = parseDay(day)
  date.setDate(date.getDate() + days)
  return todayISO(date)
}
/** Segunda-feira da semana do dia indicado. */
const weekStart = (day: string) => addDays(day, -((parseDay(day).getDay() + 6) % 7))
const localDayOf = (iso: string) => todayISO(new Date(iso))

type Item = { kind: 'entry'; at: string; entry: ClinicCalendarEntry } | { kind: 'free'; at: string; slot: ClinicCalendarFreeSlot }

function EntryRow({ entry }: { entry: ClinicCalendarEntry }) {
  // Chegou / Em consulta vêm do estado do dia (BR-CLN-28); os restantes, do estado Vita.
  const status =
    entry.dayState === 'ARRIVED' || entry.dayState === 'IN_PROGRESS' ? dayStateLabel[entry.dayState] : appointmentStatus[entry.status]
  const body = (
    <>
      <span className="flex items-center gap-2">
        <span className="text-sm font-semibold tabular-nums">
          {formatTime(entry.startsAt)}–{formatTime(entry.endsAt)}
        </span>
        {entry.kind === 'EXAM' && <FlaskConical className="size-3.5 text-primary" aria-label="Exame" />}
        <span className="ml-auto flex flex-wrap justify-end gap-1">
          <ConfirmationBadge status={entry.status} confirmationStatus={entry.confirmationStatus} />
          <Badge tone={status.tone}>{status.label}</Badge>
        </span>
      </span>
      <span className="truncate text-sm font-medium">{entry.patientName}</span>
      <span className="truncate text-xs text-muted">
        {[entry.source === 'MANUAL' ? 'Visita presencial' : null, entry.specialty].filter(Boolean).join(' · ')}
      </span>
      {entry.status === 'CANCELLED' && entry.confirmationStatus === 'DECLINED' && (
        <span className="text-xs font-medium text-danger">Recusou – horário livre</span>
      )}
      {entry.dayState === 'ARRIVED' && entry.waitingMinutes != null && (
        <span className="text-xs text-muted">À espera há {entry.waitingMinutes} min</span>
      )}
    </>
  )
  const classes = 'flex flex-col gap-0.5 rounded-lg border border-border bg-surface px-3 py-2 text-left'
  return entry.clinicPatientId ? (
    <Link to={paths.clinicPatient(entry.clinicPatientId)} className={cn(classes, 'transition-colors hover:bg-surface-muted')}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  )
}

function FreeRow({ slot, onBook }: { slot: ClinicCalendarFreeSlot; onBook?: (slotId: string) => void }) {
  const label = `${formatTime(slot.startsAt)}–${formatTime(slot.endsAt)} · Livre${slot.specialty ? ` · ${slot.specialty}` : ''}`
  const classes = 'rounded-lg border border-dashed border-border-strong px-3 py-1.5 text-left text-xs text-muted'
  return slot.kind === 'APPOINTMENT' && onBook ? (
    <button
      type="button"
      onClick={() => onBook(slot.slotId)}
      className={cn(classes, 'transition-colors hover:border-primary hover:text-primary')}
    >
      {label} · Marcar
    </button>
  ) : (
    <div className={classes}>{label}</div>
  )
}

function Column({ title, subtitle, items, onBook }: { title: string; subtitle?: string; items: Item[]; onBook?: (slotId: string) => void }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-2">
      <header>
        <h3 className="truncate text-sm font-semibold first-letter:uppercase">{title}</h3>
        {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
      </header>
      {items.length === 0 ? (
        <p className="rounded-lg bg-surface-muted px-3 py-2 text-xs text-muted">Sem marcações.</p>
      ) : (
        items.map((item) =>
          item.kind === 'entry' ? (
            <EntryRow key={`e-${item.entry.id}`} entry={item.entry} />
          ) : (
            <FreeRow key={`f-${item.slot.slotId}`} slot={item.slot} onBook={onBook} />
          ),
        )
      )}
    </section>
  )
}

const byTime = (a: Item, b: Item) => a.at.localeCompare(b.at)

interface ClinicCalendarViewProps {
  /** Marcar uma consulta num horário livre (abre o fluxo presencial com o horário escolhido). */
  onBookSlot?: (slotId: string) => void
  /** Muda quando há novas marcações, para recarregar o calendário. */
  version?: number
}

/**
 * Calendário por profissional (UC-CLN-19, BR-CLN-23): vista dia ou semana, com seletor de
 * profissional. Mostra consultas, exames, visitas presenciais manuais e os horários livres.
 * O agrupamento por profissional e por dia é feito aqui, sobre `GET /clinic-portal/calendar`.
 */
export function ClinicCalendarView({ onBookSlot, version = 0 }: ClinicCalendarViewProps) {
  const [range, setRange] = useState<Range>('day')
  const [day, setDay] = useState(todayISO())
  const [professionalId, setProfessionalId] = useState('')

  // O Médico vê só a sua coluna e não lê o catálogo (BR-CLN-39).
  const { isDoctor, session } = useClinicAuth()
  const professionals = useAsync(
    () => (isDoctor ? Promise.resolve([]) : clinicCatalogService.listProfessionals({ active: true })),
    [isDoctor],
  )
  const start = range === 'week' ? weekStart(day) : day
  const end = addDays(start, range === 'week' ? 7 : 1)
  const { state, reload } = useAsync(
    () =>
      clinicPatientsService.getCalendar({
        from: parseDay(start).toISOString(),
        to: parseDay(end).toISOString(),
        professionalId: professionalId || undefined,
      }),
    [start, end, professionalId, version],
  )

  const list =
    isDoctor && session?.professionalId
      ? [{ id: session.professionalId, name: 'A minha agenda', specialty: undefined }]
      : professionals.state.status === 'success'
        ? professionals.state.data
        : []
  const shift = range === 'week' ? 7 : 1
  const title =
    range === 'week' ? `${formatLongDate(parseDay(start).toISOString())} – ${formatLongDate(parseDay(addDays(start, 6)).toISOString())}` : formatLongDate(parseDay(day).toISOString())

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Tabs
          label="Vista do calendário"
          value={range}
          onChange={setRange}
          items={[
            { value: 'day', label: 'Dia' },
            { value: 'week', label: 'Semana' },
          ]}
          className="w-44"
        />
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" aria-label="Anterior" onClick={() => setDay(addDays(day, -shift))}>
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setDay(todayISO())}>
            Hoje
          </Button>
          <Button variant="secondary" size="sm" aria-label="Seguinte" onClick={() => setDay(addDays(day, shift))}>
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
        {!isDoctor && <div className="min-w-44 flex-1 sm:max-w-64">
          <Select
            label="Profissional"
            value={professionalId}
            placeholder="Todos os profissionais"
            options={list.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(event) => setProfessionalId(event.target.value)}
          />
        </div>}
      </div>
      <p className="font-medium first-letter:uppercase">{title}</p>

      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && (
        <CalendarBody calendar={state.data} range={range} start={start} professionals={list} professionalId={professionalId} onBookSlot={onBookSlot} />
      )}
    </div>
  )
}

function CalendarBody({
  calendar,
  range,
  start,
  professionals,
  professionalId,
  onBookSlot,
}: {
  calendar: ClinicCalendar
  range: Range
  start: string
  professionals: Array<{ id: string; name: string; specialty?: string }>
  professionalId: string
  onBookSlot?: (slotId: string) => void
}) {
  const items: Item[] = useMemo(
    () =>
      [
        ...calendar.entries.map((entry): Item => ({ kind: 'entry', at: entry.startsAt, entry })),
        ...calendar.freeSlots.map((slot): Item => ({ kind: 'free', at: slot.startsAt, slot })),
      ].sort(byTime),
    [calendar],
  )
  const professionalKey = (item: Item) =>
    (item.kind === 'entry' ? item.entry.professionalId : item.slot.professionalId) ?? NO_PROFESSIONAL

  if (range === 'week') {
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        {days.map((d) => (
          <Column
            key={d}
            title={weekdayFormat.format(parseDay(d))}
            items={items.filter((item) => localDayOf(item.at) === d)}
            onBook={onBookSlot}
          />
        ))}
      </div>
    )
  }

  // Dia: uma coluna por profissional (todos) ou só a do profissional escolhido.
  const known = new Set(professionals.map((p) => p.id))
  const groups = professionals
    .filter((p) => !professionalId || p.id === professionalId)
    .map((p) => ({ key: p.id, title: p.name, subtitle: p.specialty }))
  if (!professionalId && items.some((i) => !known.has(professionalKey(i)))) {
    groups.push({ key: NO_PROFESSIONAL, title: 'Sem profissional', subtitle: undefined })
  }
  if (groups.length === 0) groups.push({ key: NO_PROFESSIONAL, title: 'Marcações', subtitle: undefined })
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {groups.map((group) => (
        <Column
          key={group.key}
          title={group.title}
          subtitle={group.subtitle}
          items={items.filter((i) =>
            group.key === NO_PROFESSIONAL
              ? professionals.length === 0 || !known.has(professionalKey(i))
              : professionalKey(i) === group.key,
          )}
          onBook={onBookSlot}
        />
      ))}
    </div>
  )
}
