import { useState } from 'react'
import { CalendarClock, Pencil, Plus, Trash2 } from 'lucide-react'
import { SpecialtyField } from '@/components/domain/AppointmentFields'
import { DateStrip, nextDays } from '@/components/domain/DatePickers'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { APPOINTMENT_TIMES, localDay } from '@/lib/appointment'
import { cn } from '@/lib/cn'
import { todayISO } from '@/lib/date'
import { errorMessage } from '@/lib/errors'
import { formatCount, formatRelativeDay, formatTime } from '@/lib/format'
import { clinicPortalService } from '@/services/clinicPortal.service'
import { MAX_SLOT_CAPACITY, SLOT_DURATIONS, type ClinicSlotView, type SlotKind } from '@/types/clinic'

const SLOT_DAYS = 21

const slotStates: Record<ClinicSlotView['state'], { label: string; tone: Tone }> = {
  FREE: { label: 'Livre', tone: 'success' },
  REQUESTED: { label: 'Pedido', tone: 'warning' },
  SCHEDULED: { label: 'Confirmado', tone: 'primary' },
  PARTIAL: { label: 'Com vagas', tone: 'primary' },
  FULL: { label: 'Cheio', tone: 'neutral' },
}

const KIND_TABS: Array<{ kind: SlotKind; label: string }> = [
  { kind: 'APPOINTMENT', label: 'Consultas' },
  { kind: 'EXAM', label: 'Exames' },
]

/** Vagas de um horário de exame: ocupadas / total (BR-APT-11). */
const vagas = (slot: ClinicSlotView) => `${slot.bookedCount}/${slot.capacity} vagas`

interface PublishFormProps {
  kind: SlotKind
  initialDate: string
  onClose: () => void
  onPublished: () => void
}

/** Publicar horários num dia (UC-CLN-04): especialidade, profissional, duração e várias horas. */
function PublishForm({ kind, initialDate, onClose, onPublished }: PublishFormProps) {
  const toast = useToast()
  const [date, setDate] = useState(initialDate)
  const [specialty, setSpecialty] = useState('')
  const [professionalName, setProfessionalName] = useState('')
  const [duration, setDuration] = useState('30')
  const [times, setTimes] = useState<string[]>([])
  const [capacity, setCapacity] = useState('1')
  const isExam = kind === 'EXAM'
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const toggle = (time: string) =>
    setTimes((current) => (current.includes(time) ? current.filter((t) => t !== time) : [...current, time].sort()))

  async function publish() {
    if (!date || !specialty.trim() || times.length === 0) {
      return setError(`Indique o dia, ${isExam ? 'o tipo de exame' : 'a especialidade'} e pelo menos uma hora.`)
    }
    const slots = Number(capacity)
    if (isExam && (!Number.isInteger(slots) || slots < 1 || slots > MAX_SLOT_CAPACITY)) {
      return setError(`As vagas por horário têm de ser entre 1 e ${MAX_SLOT_CAPACITY}.`)
    }
    setSaving(true)
    try {
      const created = await clinicPortalService.publishSlots({
        kind,
        capacity: isExam ? slots : 1,
        date,
        times,
        specialty,
        professionalName,
        durationMinutes: Number(duration),
      })
      toast.show(
        created.length > 0
          ? `${formatCount(created.length, 'horário publicado', 'horários publicados')}.`
          : 'Esses horários já existiam ou já passaram.',
      )
      onPublished()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isExam ? 'Publicar horários de exame' : 'Publicar horários'}
      description={
        isExam
          ? 'Os pacientes agendam o exame diretamente num horário com vagas.'
          : 'Os pacientes passam a poder pedir consulta nestas horas.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button onClick={publish} loading={saving}>
            Publicar
          </Button>
        </>
      }
    >
      <div className="flex max-h-[60dvh] flex-col gap-4 overflow-y-auto pr-1">
        <Input label="Dia" type="date" min={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        {isExam ? (
          <Input
            label="Tipo de exame"
            placeholder="Ex.: Análises clínicas"
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
          />
        ) : (
          <SpecialtyField value={specialty} onChange={setSpecialty} />
        )}
        {isExam && (
          <Input
            label="Vagas por horário"
            type="number"
            min={1}
            max={MAX_SLOT_CAPACITY}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            hint="Quantos pacientes podem agendar a mesma hora."
          />
        )}
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Profissional (opcional)"
            value={professionalName}
            onChange={(e) => setProfessionalName(e.target.value)}
          />
          <Select
            label="Duração"
            options={SLOT_DURATIONS.map((m) => ({ value: String(m), label: `${m} min` }))}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Horas ({times.length} escolhidas)</span>
          <div className="grid grid-cols-4 gap-2">
            {APPOINTMENT_TIMES.map((time) => {
              const selected = times.includes(time)
              return (
                <button
                  key={time}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggle(time)}
                  className={cn(
                    'h-10 rounded-full border text-sm font-medium tabular-nums transition-colors',
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
        </div>
        <FormError message={error} />
      </div>
    </Modal>
  )
}

/** Horários publicados por dia, com o estado de cada um; só os livres se removem (BR-CLN-04). */
export function ClinicSlotsPage() {
  const toast = useToast()
  const [kind, setKind] = useState<SlotKind>('APPOINTMENT')
  const { state, reload } = useAsync(() => clinicPortalService.listSlots(kind), [kind])
  const [editing, setEditing] = useState<ClinicSlotView | null>(null)
  const [day, setDay] = useState<string | null>(todayISO())
  const [publishing, setPublishing] = useState(false)

  const slots = state.status === 'success' ? state.data : []
  const marked = new Set(slots.map((s) => localDay(s.startsAt)))
  const shown = slots.filter((s) => localDay(s.startsAt) === day)

  async function remove(slot: ClinicSlotView) {
    try {
      await clinicPortalService.removeSlot(slot.id)
      toast.show('Horário removido.')
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      reload()
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Horários</h1>
        <Button size="sm" onClick={() => setPublishing(true)} icon={<Plus className="size-4" aria-hidden />}>
          Publicar horários
        </Button>
      </div>
      <div role="tablist" aria-label="Tipo de horário" className="flex gap-2">
        {KIND_TABS.map((tab) => (
          <button
            key={tab.kind}
            type="button"
            role="tab"
            aria-selected={kind === tab.kind}
            onClick={() => setKind(tab.kind)}
            className={cn(
              'h-10 rounded-full border px-4 text-sm font-medium transition-colors',
              kind === tab.kind
                ? 'border-transparent bg-primary text-primary-foreground'
                : 'border-border bg-surface hover:border-border-strong',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <DateStrip days={nextDays(SLOT_DAYS)} value={day} onChange={setDay} marked={marked} label="Escolher dia" />
      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted">
            {day ? formatRelativeDay(day) : ''} · {formatCount(shown.length, 'horário', 'horários')}
          </h2>
          {shown.length > 0 ? (
            <Card className="divide-y divide-border py-1">
              {shown.map((slot) => {
                const status = slotStates[slot.state]
                return (
                  <div key={slot.id} className="flex items-center gap-3 py-2.5">
                    <span className="flex w-12 shrink-0 flex-col">
                      <span className="font-semibold tabular-nums">{formatTime(slot.startsAt)}</span>
                      <span className="text-xs text-muted">{slot.durationMinutes} min</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{slot.specialty}</span>
                      <span className="block truncate text-sm text-muted">
                        {slot.professionalName ?? 'Sem profissional indicado'}
                      </span>
                    </span>
                    <Badge tone={status.tone} dot>
                      {slot.kind === 'EXAM' ? vagas(slot) : status.label}
                    </Badge>
                    {slot.kind === 'EXAM' && (
                      <button
                        type="button"
                        onClick={() => setEditing(slot)}
                        aria-label={`Alterar vagas do horário das ${formatTime(slot.startsAt)}, ${slot.specialty}`}
                        className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-border"
                      >
                        <Pencil className="size-4" aria-hidden />
                      </button>
                    )}
                    {slot.bookedCount === 0 ? (
                      <button
                        type="button"
                        onClick={() => remove(slot)}
                        aria-label={`Remover horário das ${formatTime(slot.startsAt)}, ${slot.specialty}`}
                        className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-danger-soft hover:text-danger"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    ) : (
                      <span className="size-9 shrink-0" aria-hidden />
                    )}
                  </div>
                )
              })}
            </Card>
          ) : (
            <EmptyState icon={CalendarClock} title="Sem horários neste dia." />
          )}
        </section>
      )}

      {publishing && (
        <PublishForm
          kind={kind}
          initialDate={day ?? todayISO()}
          onClose={() => setPublishing(false)}
          onPublished={() => {
            setPublishing(false)
            reload()
          }}
        />
      )}

      {editing && (
        <CapacityModal
          slot={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            toast.show('Vagas atualizadas.')
            reload()
          }}
        />
      )}
    </>
  )
}

interface CapacityModalProps {
  slot: ClinicSlotView
  onClose: () => void
  onSaved: () => void
}

/** Alterar as vagas de um horário de exame; nunca abaixo das marcações ativas (BR-APT-11). */
function CapacityModal({ slot, onClose, onSaved }: CapacityModalProps) {
  const [value, setValue] = useState(String(slot.capacity))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    const capacity = Number(value)
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_SLOT_CAPACITY) {
      return setError(`Indique um número entre 1 e ${MAX_SLOT_CAPACITY}.`)
    }
    if (capacity < slot.bookedCount) {
      return setError(`Já há ${slot.bookedCount} marcações; as vagas não podem ser menos.`)
    }
    setSaving(true)
    try {
      await clinicPortalService.updateSlotCapacity(slot.id, capacity)
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Alterar vagas"
      description={`${slot.specialty} às ${formatTime(slot.startsAt)} — ${slot.bookedCount} marcadas.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            Guardar
          </Button>
        </>
      }
    >
      <Input
        label="Vagas"
        type="number"
        min={Math.max(1, slot.bookedCount)}
        max={MAX_SLOT_CAPACITY}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setError(null)
        }}
      />
      <FormError message={error} />
    </Modal>
  )
}
