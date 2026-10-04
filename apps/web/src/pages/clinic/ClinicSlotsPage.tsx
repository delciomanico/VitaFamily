import { useState } from 'react'
import { CalendarClock, Plus, Trash2 } from 'lucide-react'
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
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { APPOINTMENT_TIMES, localDay } from '@/lib/appointment'
import { cn } from '@/lib/cn'
import { todayISO } from '@/lib/date'
import { errorMessage } from '@/lib/errors'
import { formatCount, formatRelativeDay, formatTime } from '@/lib/format'
import { SLOT_DURATIONS, clinicPortalService } from '@/services/clinicPortal.service'
import type { ClinicSlotView } from '@/types/clinic'

const SLOT_DAYS = 21

const slotStates: Record<ClinicSlotView['state'], { label: string; tone: Tone }> = {
  FREE: { label: 'Livre', tone: 'success' },
  REQUESTED: { label: 'Pedido', tone: 'warning' },
  SCHEDULED: { label: 'Confirmado', tone: 'primary' },
}

interface PublishFormProps {
  initialDate: string
  onClose: () => void
  onPublished: () => void
}

/** Publicar horários num dia (UC-CLN-04): especialidade, profissional, duração e várias horas. */
function PublishForm({ initialDate, onClose, onPublished }: PublishFormProps) {
  const { user } = useAuth()
  const toast = useToast()
  const [date, setDate] = useState(initialDate)
  const [specialty, setSpecialty] = useState('')
  const [professionalName, setProfessionalName] = useState('')
  const [duration, setDuration] = useState('30')
  const [times, setTimes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const toggle = (time: string) =>
    setTimes((current) => (current.includes(time) ? current.filter((t) => t !== time) : [...current, time].sort()))

  async function publish() {
    if (!date || !specialty.trim() || times.length === 0) {
      return setError('Indique o dia, a especialidade e pelo menos uma hora.')
    }
    setSaving(true)
    try {
      const created = await clinicPortalService.publishSlots(user?.id ?? '', {
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
      title="Publicar horários"
      description="Os pacientes passam a poder pedir consulta nestas horas."
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
        <SpecialtyField value={specialty} onChange={setSpecialty} />
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
  const { user } = useAuth()
  const toast = useToast()
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(() => clinicPortalService.listClinicSlots(userId), [userId])
  const [day, setDay] = useState<string | null>(todayISO())
  const [publishing, setPublishing] = useState(false)

  const slots = state.status === 'success' ? state.data : []
  const marked = new Set(slots.map((s) => localDay(s.startsAt)))
  const shown = slots.filter((s) => localDay(s.startsAt) === day)

  async function remove(slot: ClinicSlotView) {
    try {
      await clinicPortalService.removeSlot(userId, slot.id)
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
                      {status.label}
                    </Badge>
                    {slot.state === 'FREE' ? (
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
          initialDate={day ?? todayISO()}
          onClose={() => setPublishing(false)}
          onPublished={() => {
            setPublishing(false)
            reload()
          }}
        />
      )}
    </>
  )
}
