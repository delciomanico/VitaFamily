import { useState, type FormEvent } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { CalendarCheck, Clock, Pencil, Repeat } from 'lucide-react'
import { ConfirmationButtons } from '@/components/domain/ConfirmationButtons'
import { NO_CLINIC, SpecialtyField } from '@/components/domain/AppointmentFields'
import { RecommendationsSection } from '@/components/domain/RecommendationsSection'
import { Page } from '@/components/layout/Page'
import { Badge } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DetailSection, InfoList, InfoRow } from '@/components/ui/InfoList'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { appointmentStatusLabel, combineDateTime, isUpcoming, localDay, needsOutcome } from '@/lib/appointment'
import { localTime, todayISO } from '@/lib/date'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatLongDate, formatTime } from '@/lib/format'
import { paths } from '@/routes/paths'
import { appointmentService, type AppointmentInput } from '@/services/appointment.service'
import { clinicService } from '@/services/clinic.service'
import type { AppointmentItem } from '@/types/appointment'
import type { Clinic } from '@/types/clinic'

interface EditFormProps {
  item: AppointmentItem
  clinics: Clinic[]
  onSubmit: (input: AppointmentInput) => Promise<void>
  onCancel: () => void
}

/** Editar ou reagendar (UC-APT-02): especialidade, clínica, profissional, data, hora e observações. */
function AppointmentEditForm({ item: { appointment }, clinics, onSubmit, onCancel }: EditFormProps) {
  const [specialty, setSpecialty] = useState(appointment.specialty ?? '')
  const [clinicId, setClinicId] = useState(appointment.clinicId ?? NO_CLINIC)
  const [professionalName, setProfessionalName] = useState(appointment.professionalName ?? '')
  const [date, setDate] = useState(localDay(appointment.scheduledAt))
  const [time, setTime] = useState(localTime(appointment.scheduledAt))
  const [notes, setNotes] = useState(appointment.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!specialty.trim()) return setError('Indique a especialidade.')
    if (!date || !time || Date.parse(combineDateTime(date, time)) <= Date.now()) {
      return setError('Escolha uma data e hora futuras.')
    }
    setSaving(true)
    await onSubmit({
      scheduledAt: combineDateTime(date, time),
      specialty,
      clinicId: clinicId === NO_CLINIC ? undefined : clinicId,
      professionalName,
      notes,
    })
    setSaving(false)
  }

  // Registo direto: só clínicas privadas (as parceiras marcam-se por horário, BR-APT-04).
  const options = [
    ...clinics.filter((c) => c.type === 'PRIVATE').map((c) => ({ value: c.id, label: c.name })),
    { value: NO_CLINIC, label: 'Sem clínica' },
  ]

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <SpecialtyField value={specialty} onChange={setSpecialty} />
      <Select label="Clínica" options={options} value={clinicId} onChange={(e) => setClinicId(e.target.value)} />
      <Input
        label="Profissional (opcional)"
        value={professionalName}
        onChange={(e) => setProfessionalName(e.target.value)}
      />
      <div className="grid grid-cols-2 gap-4">
        <Input label="Data" type="date" min={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        <Input label="Hora" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </div>
      <Textarea label="Observações (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <FormError message={error} />
      <div className="flex flex-col gap-2 pt-2 sm:flex-row-reverse">
        <Button type="submit" size="lg" loading={saving} className="sm:flex-1">
          Guardar
        </Button>
        <Button variant="ghost" size="lg" onClick={onCancel} className="sm:flex-1">
          Cancelar
        </Button>
      </div>
    </form>
  )
}

type Outcome = 'COMPLETED' | 'NO_SHOW'

interface ViewProps {
  item: AppointmentItem
  selfMemberId?: string
  onCancel: () => void
  onOutcome: (outcome: Outcome) => void
  onConfirmed: () => void
  saving: Outcome | null
}

/** Especialidade, clínica, profissional, data, hora e estado. */
function AppointmentView({
  item: { appointment, memberName },
  selfMemberId,
  onCancel,
  onOutcome,
  onConfirmed,
  saving,
}: ViewProps) {
  const status = appointmentStatusLabel(appointment)
  // Só consultas SCHEDULED, futuras e de clínica parceira (com horário) se podem responder.
  const canRespond = appointment.status === 'SCHEDULED' && Boolean(appointment.slotId) && isUpcoming(appointment)
  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold">{appointment.specialty ?? appointment.reason ?? 'Consulta'}</h2>
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
        </div>
        {appointment.memberId !== selfMemberId && <p className="text-muted">{memberName}</p>}
      </div>

      {appointment.status === 'REQUESTED' && (
        <p className="flex items-start gap-2.5 rounded-xl bg-warning-soft px-3.5 py-3 text-sm text-warning">
          <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Pedido enviado à {appointment.clinicName}. A consulta fica marcada quando a clínica confirmar; se ninguém
            responder até à hora, o pedido é cancelado.
          </span>
        </p>
      )}
      {/* M14 Q (BR-CLN-25/26): confirmar a presença nas consultas de clínica parceira. */}
      {appointment.status === 'SCHEDULED' && appointment.confirmationStatus === 'CONFIRMED' && (
        <p className="flex items-center gap-2.5 rounded-xl bg-success-soft px-3.5 py-3 text-sm text-success">
          <CalendarCheck className="size-4 shrink-0" aria-hidden />
          Presença confirmada.
        </p>
      )}
      {canRespond && (
        <DetailSection title="Vai à consulta?">
          <p className="-mt-1 text-sm text-muted">
            {appointment.confirmationStatus === 'CONFIRMED'
              ? 'Se mudar de ideias, pode avisar a clínica.'
              : 'Avise a clínica. Se não puder, o horário fica livre para outras pessoas.'}
          </p>
          <ConfirmationButtons appointment={appointment} onDone={onConfirmed} size="lg" />
        </DetailSection>
      )}
      {appointment.confirmationStatus === 'DECLINED' && (
        <div className="flex flex-col gap-3 rounded-xl bg-surface-muted px-3.5 py-3 text-sm">
          <p>Avisou que não pode ir. A consulta foi cancelada e o horário ficou livre.</p>
          <ButtonLink to={paths.appointmentNew} variant="soft">
            Escolher outro horário
          </ButtonLink>
        </div>
      )}
      {appointment.status === 'COMPLETED' && appointment.followUpDueOn && (
        <div className="flex flex-col gap-3 rounded-xl bg-primary-soft px-3.5 py-3 text-sm text-primary">
          <p className="flex items-center gap-2.5">
            <Repeat className="size-4 shrink-0" aria-hidden />
            Retorno sugerido para {formatLongDate(appointment.followUpDueOn)}.
          </p>
          <ButtonLink to={paths.appointmentNew} variant="primary">
            Marcar retorno
          </ButtonLink>
        </div>
      )}
      {appointment.responseNote && (
        <p className="rounded-xl bg-surface-muted px-3.5 py-3 text-sm">
          <span className="font-medium">Resposta da clínica: </span>
          {appointment.responseNote}
        </p>
      )}

      <InfoList>
        <InfoRow label="Data" value={formatLongDate(appointment.scheduledAt)} />
        <InfoRow label="Hora" value={formatTime(appointment.scheduledAt)} />
        <InfoRow label="Clínica" value={appointment.clinicName ?? 'Não indicada'} />
        <InfoRow label="Profissional" value={appointment.professionalName ?? 'Não indicado'} />
      </InfoList>

      {(appointment.reason || appointment.notes) && (
        <DetailSection title="Observações">
          <Card>
            <p className="whitespace-pre-line">{[appointment.reason, appointment.notes].filter(Boolean).join('\n')}</p>
          </Card>
        </DetailSection>
      )}

      <RecommendationsSection memberId={appointment.memberId} origin={{ appointmentId: appointment.id }} />

      {needsOutcome(appointment) && (
        <DetailSection title="Como correu?">
          <p className="-mt-1 text-sm text-muted">A consulta já passou. Indique se foi realizada.</p>
          <div className="grid grid-cols-2 gap-2">
            <Button size="lg" onClick={() => onOutcome('COMPLETED')} loading={saving === 'COMPLETED'}>
              Realizada
            </Button>
            <Button variant="secondary" size="lg" onClick={() => onOutcome('NO_SHOW')} loading={saving === 'NO_SHOW'}>
              Faltou
            </Button>
          </div>
        </DetailSection>
      )}

      {(appointment.status === 'SCHEDULED' || appointment.status === 'REQUESTED') && (
        <Button variant="danger-ghost" size="lg" onClick={onCancel}>
          {appointment.status === 'REQUESTED' ? 'Desistir do pedido' : 'Cancelar consulta'}
        </Button>
      )}
    </>
  )
}

/** Detalhe da consulta; `?editar` abre o formulário (o botão voltar funciona). */
export function AppointmentDetailPage() {
  const { id = '' } = useParams()
  const { user, family, member } = useAuth()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState<Outcome | 'CANCELLED' | null>(null)
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(
    () => Promise.all([appointmentService.getAppointment(familyId, userId, id), clinicService.listClinics(familyId)]),
    [familyId, userId, id],
  )

  // As de clínica parceira mudam-se cancelando e pedindo outro horário (BR-APT-09).
  const current = state.status === 'success' ? state.data[0].appointment : null
  const canEdit = current !== null && current.status === 'SCHEDULED' && isUpcoming(current) && !current.slotId
  const requested = current?.status === 'REQUESTED'
  const editing = params.has('editar') && canEdit
  const setEditing = (on: boolean) => setParams(on ? { editar: '' } : {}, { replace: !on })

  async function save(input: AppointmentInput) {
    try {
      await appointmentService.updateAppointment(familyId, userId, id, input)
      toast.show('Consulta atualizada.')
      setEditing(false)
      reload()
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    }
  }

  async function setStatus(status: Outcome | 'CANCELLED') {
    setSaving(status)
    try {
      await appointmentService.setAppointmentStatus(familyId, userId, id, status)
      const done = {
        CANCELLED: 'Consulta cancelada.',
        COMPLETED: 'Consulta registada como realizada.',
        NO_SHOW: 'Falta registada.',
      }
      toast.show(done[status])
      setConfirming(false)
      reload()
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setSaving(null)
    }
  }

  const editButton = canEdit && !editing && (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => setEditing(true)}
      icon={<Pencil className="size-4" aria-hidden />}
    >
      Editar
    </Button>
  )

  return (
    <Page
      title={editing ? 'Editar consulta' : 'Consulta'}
      backTo={paths.appointments}
      backLabel="Agenda"
      action={editButton}
    >
      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' &&
        (isAppError(state.error, 'NOT_FOUND') ? (
          <ErrorState message="Esta consulta não existe ou não tem acesso a ela." />
        ) : (
          <ErrorState onRetry={reload} />
        ))}
      {state.status === 'success' &&
        (editing ? (
          <AppointmentEditForm
            item={state.data[0]}
            clinics={state.data[1]}
            onSubmit={save}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <AppointmentView
            item={state.data[0]}
            selfMemberId={member?.id}
            onCancel={() => setConfirming(true)}
            onOutcome={setStatus}
            onConfirmed={reload}
            saving={saving === 'CANCELLED' ? null : saving}
          />
        ))}

      <ConfirmDialog
        open={confirming}
        title={requested ? 'Desistir do pedido?' : 'Cancelar consulta?'}
        description={
          requested
            ? 'O pedido é cancelado e o horário fica livre para outras pessoas.'
            : 'A consulta fica no histórico como cancelada e os lembretes deixam de ser enviados.'
        }
        confirmLabel={requested ? 'Desistir do pedido' : 'Cancelar consulta'}
        destructive
        loading={saving === 'CANCELLED'}
        onConfirm={() => setStatus('CANCELLED')}
        onCancel={() => setConfirming(false)}
      />
    </Page>
  )
}
