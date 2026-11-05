import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DateStrip } from '@/components/domain/DatePickers'
import { Page } from '@/components/layout/Page'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { Select } from '@/components/ui/Select'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { localDay } from '@/lib/appointment'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatCount, formatTime } from '@/lib/format'
import { paths } from '@/routes/paths'
import { appointmentService } from '@/services/appointment.service'
import { examinationService } from '@/services/examination.service'
import { familyService } from '@/services/family.service'
import type { AvailableSlot } from '@/types/clinic'
import type { FamilyMember } from '@/types/family'
import { CalendarClock } from 'lucide-react'

interface ScheduleFormProps {
  members: FamilyMember[]
  selfMemberId: string
  slots: AvailableSlot[]
  onBooked: () => void
}

/**
 * Agendar um exame num horário com vagas de uma clínica parceira (ADR-023, BR-APT-11).
 * Não há pedido nem confirmação: ao confirmar, o exame fica logo agendado e ocupa uma vaga.
 */
function ScheduleForm({ members, selfMemberId, slots, onBooked }: ScheduleFormProps) {
  const { user, family } = useAuth()
  const toast = useToast()
  const types = [...new Set(slots.map((s) => s.specialty))].sort((a, b) => a.localeCompare(b, 'pt-PT'))
  const [examType, setExamType] = useState<string | null>(types[0] ?? null)
  const [day, setDay] = useState<string | null>(null)
  const [slotId, setSlotId] = useState<string | null>(null)
  const [memberId, setMemberId] = useState(selfMemberId)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const ofType = slots.filter((s) => s.specialty === examType)
  const days = [...new Set(ofType.map((s) => localDay(s.startsAt)))]
  const chosenDay = day && days.includes(day) ? day : null
  const daySlots = ofType.filter((s) => localDay(s.startsAt) === chosenDay)
  const slot = slots.find((s) => s.id === slotId)

  async function book() {
    if (!slot) return setError('Escolha um horário.')
    setSaving(true)
    try {
      await examinationService.createExamination(family?.id ?? '', user?.id ?? '', {
        memberId,
        name: slot.specialty,
        examDate: localDay(slot.startsAt),
        slotId: slot.id,
        notes,
        results: [],
        documents: [],
      })
      toast.show('Exame agendado.')
      onBooked()
    } catch (err) {
      setSlotId(null)
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (slots.length === 0) {
    return <EmptyState icon={CalendarClock} title="As clínicas parceiras não têm horários de exame disponíveis." />
  }

  return (
    <div className="flex flex-col gap-5">
      {members.length > 1 && (
        <Select
          label="Para quem"
          options={members.map((m) => ({ value: m.id, label: m.id === selfMemberId ? `${m.name} (eu)` : m.name }))}
          value={memberId}
          onChange={(e) => setMemberId(e.target.value)}
        />
      )}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Tipo de exame</span>
        <div className="flex flex-wrap gap-2">
          {types.map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={examType === type}
              onClick={() => {
                setExamType(type)
                setDay(null)
                setSlotId(null)
              }}
              className={cn(
                'h-10 rounded-full border px-4 text-sm font-medium transition-colors',
                examType === type
                  ? 'border-transparent bg-primary text-primary-foreground'
                  : 'border-border bg-surface hover:border-border-strong',
              )}
            >
              {type}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Dia ({formatCount(days.length, 'dia com vagas', 'dias com vagas')})</span>
        <DateStrip
          days={days}
          value={chosenDay}
          onChange={(value) => {
            setDay(value)
            setSlotId(null)
          }}
          label="Dia do exame"
        />
      </div>
      {chosenDay && (
        <div className="flex flex-col gap-2" role="group" aria-label="Horários do exame">
          <span className="text-sm font-medium">Horário</span>
          {daySlots.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={slotId === s.id}
              onClick={() => setSlotId(s.id)}
              className={cn(
                'flex items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors',
                slotId === s.id ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:border-border-strong',
              )}
            >
              <span className="font-semibold tabular-nums">{formatTime(s.startsAt)}</span>
              <span className="min-w-0 flex-1 truncate">{s.clinicName}</span>
              <span className="text-sm text-muted">{formatCount(s.remaining, 'vaga', 'vagas')}</span>
            </button>
          ))}
        </div>
      )}
      <Textarea label="Observações (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <FormError message={error} />
      <Button size="lg" loading={saving} disabled={!slot} onClick={() => void book()}>
        Agendar exame
      </Button>
    </div>
  )
}

/** Agendar exame numa clínica parceira (ADR-023). */
export function ScheduleExaminationPage() {
  const { user, family, member } = useAuth()
  const navigate = useNavigate()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(
    () =>
      Promise.all([
        familyService.listManagedMembers(familyId, userId),
        appointmentService.listAvailableSlots(familyId, '', 'EXAM'),
      ]),
    [familyId, userId],
  )

  return (
    <Page title="Agendar exame" backTo={paths.examinationNew} backLabel="Adicionar exame">
      {state.status === 'loading' && <LoadingState rows={4} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && (
        <ScheduleForm
          members={state.data[0]}
          selfMemberId={member?.id ?? ''}
          slots={state.data[1]}
          onBooked={() => navigate(paths.examinations, { replace: true })}
        />
      )}
    </Page>
  )
}
