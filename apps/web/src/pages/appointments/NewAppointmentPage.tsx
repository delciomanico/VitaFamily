import { useState } from 'react'
import { CalendarCheck } from 'lucide-react'
import { ChoiceList, NO_CLINIC, SpecialtyField, clinicOptions } from '@/components/domain/AppointmentFields'
import { DateStrip, TimeSlots, nextDays } from '@/components/domain/DatePickers'
import { Page } from '@/components/layout/Page'
import { Button, ButtonLink } from '@/components/ui/Button'
import { InfoList, InfoRow } from '@/components/ui/InfoList'
import { Input } from '@/components/ui/Input'
import { StepProgress } from '@/components/ui/StepProgress'
import { Textarea } from '@/components/ui/Textarea'
import { ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { APPOINTMENT_TIMES, combineDateTime } from '@/lib/appointment'
import { todayISO } from '@/lib/date'
import { errorMessage } from '@/lib/errors'
import { formatLongDate, formatTime } from '@/lib/format'
import { paths } from '@/routes/paths'
import { appointmentService } from '@/services/appointment.service'
import { clinicService } from '@/services/clinic.service'
import { familyService } from '@/services/family.service'
import type { Appointment } from '@/types/appointment'
import type { Clinic } from '@/types/clinic'
import type { FamilyMember } from '@/types/family'

/** Dias que se podem escolher na tira do calendário. */
const BOOKING_DAYS = 60

const STEPS = ['Para quem?', 'Especialidade e clínica', 'Data e hora', 'Confirmar'] as const

interface Draft {
  memberId: string | null
  specialty: string
  clinicId: string | null
  professionalName: string
  date: string | null
  time: string | null
  notes: string
}

/** Horário que já passou hoje (não se marca no passado). */
function isPast(date: string | null, time: string, now = new Date()): boolean {
  return date === todayISO(now) && Date.parse(combineDateTime(date, time)) <= now.getTime()
}

/** Mensagem de erro do passo, ou null se estiver completo. */
function stepError(step: number, draft: Draft): string | null {
  if (step === 0 && !draft.memberId) return 'Escolha para quem é a consulta.'
  if (step === 1 && !draft.specialty.trim()) return 'Indique a especialidade.'
  if (step === 1 && !draft.clinicId) return 'Escolha a clínica ou “Sem clínica”.'
  if (step === 2 && (!draft.date || !draft.time)) return 'Escolha o dia e a hora.'
  if (step === 2 && draft.date && draft.time && isPast(draft.date, draft.time)) return 'Escolha uma hora futura.'
  return null
}

interface WizardProps {
  members: FamilyMember[]
  clinics: Clinic[]
  selfMemberId: string
  onBooked: (appointment: Appointment) => void
}

/**
 * Marcar consulta por passos (UC-APT-01): membro → especialidade e clínica → profissional,
 * data e hora → confirmar. Sem pedido à clínica (BR-APT-04): a consulta fica agendada.
 */
function BookingWizard({ members, clinics, selfMemberId, onBooked }: WizardProps) {
  const { user, family } = useAuth()
  // Sem dependentes, o primeiro passo não tem escolha: começa na especialidade.
  const [step, setStep] = useState(members.length > 1 ? 0 : 1)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<Draft>({
    memberId: members.length > 1 ? null : selfMemberId,
    specialty: '',
    clinicId: null,
    professionalName: '',
    date: null,
    time: null,
    notes: '',
  })
  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setError(null)
  }

  const memberName = members.find((m) => m.id === draft.memberId)?.name ?? ''
  const clinicName = clinics.find((c) => c.id === draft.clinicId)?.name ?? 'Sem clínica'

  function next() {
    const message = stepError(step, draft)
    if (message) return setError(message)
    setStep((s) => s + 1)
  }

  async function confirm() {
    if (!draft.memberId || !draft.date || !draft.time) return
    setSaving(true)
    try {
      const appointment = await appointmentService.createAppointment(family?.id ?? '', user?.id ?? '', {
        memberId: draft.memberId,
        scheduledAt: combineDateTime(draft.date, draft.time),
        specialty: draft.specialty,
        clinicId: draft.clinicId === NO_CLINIC ? undefined : (draft.clinicId ?? undefined),
        professionalName: draft.professionalName,
        notes: draft.notes,
      })
      onBooked(appointment)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const firstStep = members.length > 1 ? 0 : 1
  const total = STEPS.length - firstStep

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <StepProgress step={step - firstStep + 1} total={total} label="Progresso da marcação" />
      </div>
      <h2 className="text-xl font-semibold">{STEPS[step]}</h2>

      {step === 0 && (
        <ChoiceList
          label="Membro"
          value={draft.memberId}
          onChange={(memberId) => set({ memberId })}
          options={members.map((m) => ({ value: m.id, title: m.id === selfMemberId ? `${m.name} (eu)` : m.name }))}
        />
      )}

      {step === 1 && (
        <>
          <SpecialtyField value={draft.specialty} onChange={(specialty) => set({ specialty })} />
          <ChoiceList
            label="Clínica"
            value={draft.clinicId}
            onChange={(clinicId) => set({ clinicId })}
            options={clinicOptions(clinics)}
          />
          <Input
            label="Profissional (opcional)"
            placeholder="Ex.: Dr.ª Ana Costa"
            value={draft.professionalName}
            onChange={(event) => set({ professionalName: event.target.value })}
          />
        </>
      )}

      {step === 2 && (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Dia</span>
            <DateStrip
              days={nextDays(BOOKING_DAYS)}
              value={draft.date}
              onChange={(date) =>
                set({ date, time: draft.time && date && isPast(date, draft.time) ? null : draft.time })
              }
              label="Dia da consulta"
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Hora</span>
            <TimeSlots
              times={APPOINTMENT_TIMES}
              value={draft.time}
              onChange={(time) => set({ time })}
              label="Hora da consulta"
              disabled={(time) => isPast(draft.date, time)}
            />
          </div>
          <Textarea
            label="Observações (opcional)"
            placeholder="Ex.: levar exames anteriores"
            value={draft.notes}
            onChange={(event) => set({ notes: event.target.value })}
          />
        </>
      )}

      {step === 3 && draft.date && draft.time && (
        <InfoList>
          <InfoRow label="Para" value={memberName} />
          <InfoRow label="Especialidade" value={draft.specialty} />
          <InfoRow label="Clínica" value={clinicName} />
          {draft.professionalName.trim() && <InfoRow label="Profissional" value={draft.professionalName} />}
          <InfoRow label="Data" value={formatLongDate(draft.date)} />
          <InfoRow label="Hora" value={draft.time} />
          {draft.notes.trim() && <InfoRow label="Observações" value={draft.notes} />}
        </InfoList>
      )}

      <FormError message={error} />

      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        {step < 3 ? (
          <Button size="lg" onClick={next} className="sm:flex-1">
            Continuar
          </Button>
        ) : (
          <Button size="lg" onClick={confirm} loading={saving} className="sm:flex-1">
            Confirmar marcação
          </Button>
        )}
        {step > firstStep ? (
          <Button variant="ghost" size="lg" onClick={() => setStep((s) => s - 1)} className="sm:flex-1">
            Voltar
          </Button>
        ) : (
          <ButtonLink to={paths.appointments} variant="ghost" size="lg" className="sm:flex-1">
            Cancelar
          </ButtonLink>
        )}
      </div>
    </div>
  )
}

/** Confirmação depois de marcar (fluxo 4: … → Marcar consulta → Confirmação). */
function Booked({ appointment }: { appointment: Appointment }) {
  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-success-soft text-success">
        <CalendarCheck className="size-8" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">Consulta marcada</h2>
        <p className="text-muted">
          {appointment.specialty} · {formatLongDate(appointment.scheduledAt)}, {formatTime(appointment.scheduledAt)}
        </p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-2">
        <ButtonLink to={paths.appointment(appointment.id)} size="lg" fullWidth>
          Ver consulta
        </ButtonLink>
        <ButtonLink to={paths.appointments} variant="ghost" size="lg" fullWidth>
          Voltar à agenda
        </ButtonLink>
      </div>
    </div>
  )
}

export function NewAppointmentPage() {
  const { user, family, member } = useAuth()
  const [booked, setBooked] = useState<Appointment | null>(null)
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(
    () => Promise.all([familyService.listManagedMembers(familyId, userId), clinicService.listClinics(familyId)]),
    [familyId, userId],
  )

  return (
    <Page title="Marcar consulta" backTo={paths.appointments} backLabel="Agenda">
      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' &&
        (booked ? (
          <Booked appointment={booked} />
        ) : (
          <BookingWizard
            members={state.data[0]}
            clinics={state.data[1]}
            selfMemberId={member?.id ?? ''}
            onBooked={setBooked}
          />
        ))}
    </Page>
  )
}
