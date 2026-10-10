import { useState } from 'react'
import { CalendarCheck, Clock } from 'lucide-react'
import { ChoiceList, NO_CLINIC, SpecialtyField } from '@/components/domain/AppointmentFields'
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
import { APPOINTMENT_TIMES, combineDateTime, localDay } from '@/lib/appointment'
import { cn } from '@/lib/cn'
import { localTime, todayISO } from '@/lib/date'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatCount, formatLongDate, formatTime } from '@/lib/format'
import { paths } from '@/routes/paths'
import { appointmentService } from '@/services/appointment.service'
import { clinicService } from '@/services/clinic.service'
import { familyService } from '@/services/family.service'
import type { Appointment } from '@/types/appointment'
import type { AvailableSlot, Clinic } from '@/types/clinic'
import type { FamilyMember } from '@/types/family'

/** Dias que se podem escolher na marcação direta (clínica privada ou sem clínica). */
const BOOKING_DAYS = 60

const STEPS = ['Para quem?', 'Especialidade', 'Clínica', 'Profissional, data e hora', 'Confirmar'] as const

/** Profissional “qualquer” nos horários da clínica parceira. */
const ANY = ''

interface Draft {
  memberId: string | null
  specialty: string
  clinicId: string | null
  /** Clínica parceira: horário escolhido e filtro de profissional. */
  slotId: string | null
  professionalFilter: string
  /** Clínica privada ou sem clínica: escrito pelo utilizador. */
  professionalName: string
  date: string | null
  time: string | null
  notes: string
}

/** Horário que já passou hoje (não se marca no passado). */
function isPast(date: string | null, time: string, now = new Date()): boolean {
  return date === todayISO(now) && Date.parse(combineDateTime(date, time)) <= now.getTime()
}

/** Pílula de escolha simples (profissional). */
function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'h-9 rounded-full border px-3.5 text-sm font-medium transition-colors',
        selected
          ? 'border-transparent bg-primary text-primary-foreground'
          : 'border-border bg-surface hover:border-border-strong',
      )}
    >
      {children}
    </button>
  )
}

interface PartnerScheduleProps {
  slots: AvailableSlot[]
  draft: Draft
  set: (patch: Partial<Draft>) => void
}

/** Horários publicados pela clínica parceira: profissional, dia (só os com vagas) e hora (D17). */
function PartnerSchedule({ slots, draft, set }: PartnerScheduleProps) {
  const professionals = [...new Set(slots.map((s) => s.professionalName).filter((p): p is string => Boolean(p)))]
  const byProfessional = slots.filter(
    (s) => !draft.professionalFilter || s.professionalName === draft.professionalFilter,
  )
  const days = [...new Set(byProfessional.map((s) => localDay(s.startsAt)))]
  const day = draft.date && days.includes(draft.date) ? draft.date : null
  const daySlots = byProfessional.filter((s) => localDay(s.startsAt) === day)
  // Uma hora por pílula; com vários profissionais à mesma hora, fica o primeiro.
  const slotByTime = new Map<string, AvailableSlot>()
  for (const slot of daySlots)
    if (!slotByTime.has(localTime(slot.startsAt))) slotByTime.set(localTime(slot.startsAt), slot)
  const selected = slots.find((s) => s.id === draft.slotId)

  return (
    <>
      {professionals.length > 1 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Profissional</span>
          <div className="flex flex-wrap gap-2">
            <Chip selected={!draft.professionalFilter} onClick={() => set({ professionalFilter: ANY, slotId: null })}>
              Qualquer
            </Chip>
            {professionals.map((name) => (
              <Chip
                key={name}
                selected={draft.professionalFilter === name}
                onClick={() => set({ professionalFilter: name, slotId: null })}
              >
                {name}
              </Chip>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Dia ({formatCount(days.length, 'dia com vagas', 'dias com vagas')})</span>
        <DateStrip days={days} value={day} onChange={(date) => set({ date, slotId: null })} label="Dia da consulta" />
      </div>
      {day && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Hora</span>
          <TimeSlots
            times={[...slotByTime.keys()]}
            value={selected && localDay(selected.startsAt) === day ? localTime(selected.startsAt) : null}
            onChange={(time) => set({ slotId: slotByTime.get(time)?.id ?? null })}
            label="Hora da consulta"
          />
          {selected?.professionalName && (
            <p className="text-sm text-muted">
              Com {selected.professionalName} · {selected.durationMinutes} min
            </p>
          )}
        </div>
      )}
    </>
  )
}

/** Clínica privada ou sem clínica: profissional escrito e qualquer dia e hora futuros (registo direto). */
function DirectSchedule({ draft, set }: Omit<PartnerScheduleProps, 'slots'>) {
  return (
    <>
      <Input
        label="Profissional (opcional)"
        placeholder="Ex.: Dr.ª Ana Costa"
        value={draft.professionalName}
        onChange={(event) => set({ professionalName: event.target.value })}
      />
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Dia</span>
        <DateStrip
          days={nextDays(BOOKING_DAYS)}
          value={draft.date}
          onChange={(date) => set({ date, time: draft.time && date && isPast(date, draft.time) ? null : draft.time })}
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
    </>
  )
}

interface BookingSummaryProps {
  memberName: string
  specialty: string
  clinicName?: string
  partner: boolean
  professional?: string
  when: string
  notes: string
}

/** Último passo: o que vai ser marcado e, numa parceira, o que a clínica recebe (dados mínimos, D17). */
function BookingSummary({
  memberName,
  specialty,
  clinicName,
  partner,
  professional,
  when,
  notes,
}: BookingSummaryProps) {
  return (
    <>
      <InfoList>
        <InfoRow label="Para" value={memberName} />
        <InfoRow label="Especialidade" value={specialty} />
        <InfoRow label="Clínica" value={clinicName ?? 'Sem clínica'} />
        {professional && <InfoRow label="Profissional" value={professional} />}
        <InfoRow label="Data" value={formatLongDate(when)} />
        <InfoRow label="Hora" value={formatTime(when)} />
        {notes.trim() && <InfoRow label="Observações" value={notes} />}
      </InfoList>
      {partner && (
        <p className="text-sm text-muted">
          A {clinicName} recebe o nome de {memberName}, a especialidade, o profissional, a data e hora e as observações,
          para confirmar a consulta. Nenhum outro dado de saúde é partilhado.
        </p>
      )}
    </>
  )
}

interface WizardProps {
  members: FamilyMember[]
  clinics: Clinic[]
  selfMemberId: string
  onDone: (appointment: Appointment) => void
}

/**
 * Marcar consulta por passos: membro → especialidade → clínica → profissional, data e hora → confirmar.
 * Clínica parceira: só horários publicados, e o pedido aguarda confirmação (D17).
 * Clínica privada ou sem clínica: registo direto, fica agendada (BR-APT-04).
 */
function BookingWizard({ members, clinics, selfMemberId, onDone }: WizardProps) {
  const { user, family } = useAuth()
  const familyId = family?.id ?? ''
  const firstStep = members.length > 1 ? 0 : 1
  const [step, setStep] = useState(firstStep)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [slots, setSlots] = useState<AvailableSlot[] | null>(null)
  const [draft, setDraft] = useState<Draft>({
    memberId: members.length > 1 ? null : selfMemberId,
    specialty: '',
    clinicId: null,
    slotId: null,
    professionalFilter: ANY,
    professionalName: '',
    date: null,
    time: null,
    notes: '',
  })
  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setError(null)
  }

  const clinic = clinics.find((c) => c.id === draft.clinicId)
  const partner = clinic?.type === 'PARTNER'
  const clinicSlots = (slots ?? []).filter((s) => s.clinicId === draft.clinicId)
  const slot = clinicSlots.find((s) => s.id === draft.slotId)
  const memberName = members.find((m) => m.id === draft.memberId)?.name ?? ''
  const freeAt = (clinicId: string) => (slots ?? []).filter((s) => s.clinicId === clinicId).length

  /** Parceiras com vagas na especialidade; privadas (registo direto); sem clínica. */
  const clinicOptions = [
    ...clinics
      .filter((c) => c.type === 'PARTNER' && freeAt(c.id) > 0)
      .map((c) => ({
        value: c.id,
        title: c.name,
        description: `Marcação com confirmação · ${formatCount(freeAt(c.id), 'horário livre', 'horários livres')}`,
      })),
    ...clinics
      .filter((c) => c.type === 'PRIVATE')
      .map((c) => ({ value: c.id, title: c.name, description: 'Registo direto, sem confirmação' })),
    { value: NO_CLINIC, title: 'Sem clínica', description: 'Registo direto, sem indicar local' },
  ]

  async function loadSlots() {
    setSlots(await appointmentService.listAvailableSlots(familyId, draft.specialty))
  }

  function validate(): string | null {
    if (step === 0 && !draft.memberId) return 'Escolha para quem é a consulta.'
    if (step === 1 && !draft.specialty.trim()) return 'Indique a especialidade.'
    if (step === 2 && !draft.clinicId) return 'Escolha a clínica ou “Sem clínica”.'
    if (step === 3 && partner && !draft.slotId) return 'Escolha um dia e uma hora livres.'
    if (step === 3 && !partner && (!draft.date || !draft.time)) return 'Escolha o dia e a hora.'
    if (step === 3 && !partner && draft.date && draft.time && isPast(draft.date, draft.time)) {
      return 'Escolha uma hora futura.'
    }
    return null
  }

  async function next() {
    const message = validate()
    if (message) return setError(message)
    if (step === 1) {
      setSaving(true)
      try {
        await loadSlots()
        // As clínicas dependem da especialidade: limpa escolhas antigas.
        set({ clinicId: null, slotId: null, professionalFilter: ANY })
      } catch (err) {
        return setError(errorMessage(err))
      } finally {
        setSaving(false)
      }
    }
    setStep((s) => s + 1)
  }

  async function confirm() {
    if (!draft.memberId) return
    setSaving(true)
    try {
      const appointment =
        partner && draft.slotId
          ? await appointmentService.requestAppointment(familyId, user?.id ?? '', {
              memberId: draft.memberId,
              slotId: draft.slotId,
              notes: draft.notes,
            })
          : await appointmentService.createAppointment(familyId, user?.id ?? '', {
              memberId: draft.memberId,
              scheduledAt: combineDateTime(draft.date ?? '', draft.time ?? ''),
              specialty: draft.specialty,
              clinicId: draft.clinicId === NO_CLINIC ? undefined : (draft.clinicId ?? undefined),
              professionalName: draft.professionalName,
              notes: draft.notes,
            })
      onDone(appointment)
    } catch (err) {
      if (isAppError(err, 'CONFLICT')) {
        // Alguém ocupou o horário entretanto: volta à escolha com as vagas atualizadas.
        await loadSlots()
        set({ slotId: null })
        setStep(3)
        setError('Este horário acabou de ser ocupado. Escolha outro.')
      } else {
        setError(errorMessage(err))
      }
    } finally {
      setSaving(false)
    }
  }

  const when = partner ? slot?.startsAt : draft.date && draft.time ? combineDateTime(draft.date, draft.time) : undefined
  const professional = partner ? slot?.professionalName : draft.professionalName.trim()

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <StepProgress step={step - firstStep + 1} total={STEPS.length - firstStep} label="Progresso da marcação" />
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

      {step === 1 && <SpecialtyField value={draft.specialty} onChange={(specialty) => set({ specialty })} />}

      {step === 2 && (
        <ChoiceList
          label={`Clínicas para ${draft.specialty}`}
          value={draft.clinicId}
          onChange={(clinicId) => set({ clinicId, slotId: null, date: null, time: null, professionalFilter: ANY })}
          options={clinicOptions}
        />
      )}

      {step === 3 && (
        <>
          {partner ? (
            <PartnerSchedule slots={clinicSlots} draft={draft} set={set} />
          ) : (
            <DirectSchedule draft={draft} set={set} />
          )}
          <Textarea
            label="Observações (opcional)"
            placeholder="Ex.: levar exames anteriores"
            value={draft.notes}
            onChange={(event) => set({ notes: event.target.value })}
          />
        </>
      )}

      {step === 4 && when && (
        <BookingSummary
          memberName={memberName}
          specialty={slot?.specialty ?? draft.specialty}
          clinicName={clinic?.name}
          partner={partner}
          professional={professional}
          when={when}
          notes={draft.notes}
        />
      )}

      <FormError message={error} />

      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        {step < 4 ? (
          <Button size="lg" onClick={next} loading={saving} className="sm:flex-1">
            Continuar
          </Button>
        ) : (
          <Button size="lg" onClick={confirm} loading={saving} className="sm:flex-1">
            {partner ? 'Enviar pedido' : 'Confirmar marcação'}
          </Button>
        )}
        {step > firstStep ? (
          <Button
            variant="ghost"
            size="lg"
            onClick={() => {
              setError(null)
              setStep((s) => s - 1)
            }}
            className="sm:flex-1"
          >
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

/** Confirmação (fluxo 4: … → Marcar consulta → Confirmação): pedido enviado ou consulta marcada. */
function Done({ appointment }: { appointment: Appointment }) {
  const requested = appointment.status === 'REQUESTED'
  const Icon = requested ? Clock : CalendarCheck
  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <span
        className={cn(
          'flex size-16 items-center justify-center rounded-full',
          requested ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success',
        )}
      >
        <Icon className="size-8" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">{requested ? 'Pedido enviado' : 'Consulta marcada'}</h2>
        <p className="text-muted">
          {appointment.specialty} · {formatLongDate(appointment.scheduledAt)}, {formatTime(appointment.scheduledAt)}
        </p>
        {requested && (
          <p className="text-sm text-muted">
            Aguarda a confirmação da {appointment.clinicName}. Pode acompanhar o estado na Agenda.
          </p>
        )}
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
  const [done, setDone] = useState<Appointment | null>(null)
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
        (done ? (
          <Done appointment={done} />
        ) : (
          <BookingWizard
            members={state.data[0]}
            clinics={state.data[1]}
            selfMemberId={member?.id ?? ''}
            onDone={setDone}
          />
        ))}
    </Page>
  )
}
