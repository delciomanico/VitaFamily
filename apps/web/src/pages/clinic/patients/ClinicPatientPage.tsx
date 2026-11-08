import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarPlus, FlaskConical, Info, Link2, Lock, Pencil, ShieldCheck } from 'lucide-react'
import { WalkInBookingModal } from '@/components/clinic/WalkInBookingModal'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DetailSection, InfoList, InfoRow } from '@/components/ui/InfoList'
import { Tabs, type TabItem } from '@/components/ui/Tabs'
import { Textarea } from '@/components/ui/Textarea'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { ageOn } from '@/lib/date'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatAge, formatLongDate, formatShortDate, formatWhen } from '@/lib/format'
import { appointmentStatus, examinationStatus } from '@/lib/labels'
import { paths } from '@/routes/paths'
import { clinicPatientsService } from '@/services/clinicPatients.service'
import {
  CLINIC_PATIENT_NOTES_MAX,
  type ClinicBooking,
  type ClinicExamBooking,
  type ClinicPatient,
  type ClinicPatientRecord,
  type ClinicSharedHistory,
} from '@/types/clinic'
import { ReceiptAction } from '@/components/clinic/ReceiptAction'
import { useClinicAuth } from '@/contexts/ClinicAuthContext'
import { LinkPatientModal } from './LinkPatientModal'
import { PatientFormModal } from './PatientFormModal'
import { sharingLabel } from './patientLabels'

type TabValue = 'summary' | 'activity' | 'recommendations' | 'shared'

const TABS: TabItem<TabValue>[] = [
  { value: 'summary', label: 'Resumo' },
  { value: 'activity', label: 'Consultas e exames' },
  { value: 'recommendations', label: 'Recomendações' },
  { value: 'shared', label: 'Histórico partilhado' },
]

/** Estado do consentimento, em linguagem simples, e o que a clínica pode ver (BR-CLN-19/21). */
function SharingCard({ patient, onLink }: { patient: ClinicPatient; onLink: () => void }) {
  // Ligar um paciente Vita é de Admin e Gestor; o Médico só lê (BR-CLN-39).
  const { isDoctor } = useClinicAuth()
  const link = patient.vitaLink
  if (!link) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <Lock className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
          <div>
            <p className="font-medium">Sem conta Vita ligada</p>
            <p className="text-sm text-muted">
              Só vê o que a clínica registou. Para ver o histórico partilhado, ligue o paciente com o código dele.
            </p>
          </div>
        </div>
        {!isDoctor && (
          <Button size="sm" variant="secondary" onClick={onLink} icon={<Link2 className="size-4" aria-hidden />}>
            Ligar paciente Vita
          </Button>
        )}
      </Card>
    )
  }
  const history = link.consentLevel === 'HISTORY'
  return (
    <Card className="flex items-start gap-3">
      <ShieldCheck className={history ? 'mt-0.5 size-5 shrink-0 text-success' : 'mt-0.5 size-5 shrink-0 text-primary'} aria-hidden />
      <div>
        <p className="font-medium">{history ? 'Partilha o histórico' : 'Ligado à Vita · só marcações'}</p>
        <p className="text-sm text-muted">
          {history
            ? `Pode ver a medicação ativa e os exames, só para leitura, até ${link.consentValidUntil ? formatLongDate(link.consentValidUntil) : '—'}.`
            : 'O paciente partilha a identificação e as marcações. O histórico de saúde não está partilhado.'}
        </p>
      </div>
    </Card>
  )
}

function InternalNotes({ patient, onSaved }: { patient: ClinicPatient; onSaved: (patient: ClinicPatient) => void }) {
  const { isDoctor } = useClinicAuth()
  const [editing, setEditing] = useState(false)
  const [notes, setNotes] = useState(patient.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (notes.length > CLINIC_PATIENT_NOTES_MAX) return setError(`As notas têm no máximo ${CLINIC_PATIENT_NOTES_MAX} caracteres.`)
    setSaving(true)
    try {
      onSaved(await clinicPatientsService.updatePatient(patient.id, { notes: notes.trim() || null }))
      setEditing(false)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <DetailSection
      title="Notas internas"
      action={
        !editing &&
        !isDoctor && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)} icon={<Pencil className="size-4" aria-hidden />}>
            {patient.notes ? 'Editar' : 'Adicionar'}
          </Button>
        )
      }
    >
      {editing ? (
        <Card className="flex flex-col gap-3">
          <Textarea
            label="Notas internas"
            hint="Só a clínica as vê; nunca aparecem ao paciente."
            rows={4}
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value)
              setError(null)
            }}
          />
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setEditing(false)
                setNotes(patient.notes ?? '')
                setError(null)
              }}
            >
              Cancelar
            </Button>
            <Button size="sm" loading={saving} onClick={() => void save()}>
              Guardar
            </Button>
          </div>
        </Card>
      ) : patient.notes ? (
        <Card>
          <p className="text-sm whitespace-pre-wrap">{patient.notes}</p>
        </Card>
      ) : (
        <p className="text-sm text-muted">Sem notas.</p>
      )}
    </DetailSection>
  )
}

function Summary({ patient, onChanged, onLink }: { patient: ClinicPatient; onChanged: (p: ClinicPatient) => void; onLink: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      <SharingCard patient={patient} onLink={onLink} />
      <DetailSection title="Contacto">
        <InfoList>
          <InfoRow label="Telefone" value={patient.phone ?? '—'} />
          <InfoRow label="E-mail" value={patient.email ?? '—'} />
          <InfoRow
            label="Nascimento"
            value={patient.birthDate ? `${formatShortDate(patient.birthDate)} · ${formatAge(ageOn(patient.birthDate))}` : '—'}
          />
        </InfoList>
      </DetailSection>
      <InternalNotes patient={patient} onSaved={onChanged} />
    </div>
  )
}

function BookingRow({ booking, onChanged }: { booking: ClinicBooking; onChanged: () => void }) {
  const status = appointmentStatus[booking.status]
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{formatWhen(booking.scheduledAt)}</p>
        <p className="truncate text-sm text-muted">
          {['Consulta', booking.specialty, booking.professionalName].filter(Boolean).join(' · ')}
        </p>
        {booking.notes && <p className="text-sm">“{booking.notes}”</p>}
      </div>
      {booking.source === 'MANUAL' && <Badge>Visita presencial</Badge>}
      <Badge tone={status.tone} dot>
        {status.label}
      </Badge>
      {booking.status === 'COMPLETED' && (
        <ReceiptAction
          bookingKind={booking.source === 'MANUAL' ? 'VISIT' : 'APPOINTMENT'}
          bookingId={booking.id}
          receiptId={booking.receiptId}
          patientName={booking.patientName}
          serviceName={booking.specialty}
          onChanged={onChanged}
        />
      )}
    </div>
  )
}

function ExamRow({
  exam,
  patientName,
  onChanged,
}: {
  exam: ClinicExamBooking
  patientName: string
  onChanged: () => void
}) {
  const status = examinationStatus[exam.status]
  return (
    <div className="flex items-center gap-3 py-3">
      <FlaskConical className="size-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{formatWhen(exam.scheduledAt)}</p>
        <p className="truncate text-sm text-muted">{['Exame', exam.examType].filter(Boolean).join(' · ')}</p>
      </div>
      <Badge tone={status.tone} dot>
        {status.label}
      </Badge>
      {exam.status === 'COMPLETED' && (
        <ReceiptAction
          bookingKind="EXAM"
          bookingId={exam.id}
          receiptId={exam.receiptId}
          patientName={patientName}
          serviceName={exam.examType}
          onChanged={onChanged}
        />
      )}
    </div>
  )
}

function Activity({
  record,
  onBook,
  onChanged,
}: {
  record: ClinicPatientRecord
  onBook: () => void
  onChanged: () => void
}) {
  const { isDoctor } = useClinicAuth()
  const empty = record.bookings.length === 0 && record.examinations.length === 0
  if (empty) {
    return (
      <EmptyState
        icon={CalendarPlus}
        title="Ainda sem consultas nem exames."
        description="Aqui aparece a atividade da clínica com este paciente."
        action={
          isDoctor ? undefined : (
            <Button size="sm" onClick={onBook}>
              Marcar consulta
            </Button>
          )
        }
      />
    )
  }
  return (
    <div className="flex flex-col gap-5">
      <DetailSection title="Consultas">
        {record.bookings.length > 0 ? (
          <Card className="divide-y divide-border py-1">
            {record.bookings.map((booking) => (
              <BookingRow key={booking.id} booking={booking} onChanged={onChanged} />
            ))}
          </Card>
        ) : (
          <p className="text-sm text-muted">Sem consultas.</p>
        )}
      </DetailSection>
      <DetailSection title="Exames">
        {record.examinations.length > 0 ? (
          <Card className="divide-y divide-border py-1">
            {record.examinations.map((exam) => (
              <ExamRow key={exam.id} exam={exam} patientName={record.patient.name} onChanged={onChanged} />
            ))}
          </Card>
        ) : (
          <p className="text-sm text-muted">Sem exames.</p>
        )}
      </DetailSection>
    </div>
  )
}

function Recommendations({ record }: { record: ClinicPatientRecord }) {
  if (record.recommendations.length === 0) {
    return (
      <EmptyState
        icon={Info}
        title="Sem recomendações."
        description="As recomendações que emitir a pacientes Vita, nas consultas e exames, ficam aqui."
      />
    )
  }
  return (
    <Card className="divide-y divide-border py-1">
      {record.recommendations.map((recommendation) => (
        <div key={recommendation.id} className="flex flex-col gap-1 py-3">
          <p className="text-xs text-muted">{formatWhen(recommendation.createdAt)}</p>
          <p className="text-sm whitespace-pre-wrap">{recommendation.text}</p>
        </div>
      ))}
    </Card>
  )
}

/** Histórico partilhado (UC-CLN-17): só leitura, medicação ativa e exames, sem interpretação. */
function SharedHistory({ patient, onLink }: { patient: ClinicPatient; onLink: () => void }) {
  const { isDoctor } = useClinicAuth()
  const { state, reload } = useAsync(() => clinicPatientsService.getSharedHistory(patient.id), [patient.id])
  if (state.status === 'loading') return <LoadingState rows={3} />
  if (state.status === 'error') return <ErrorState onRetry={reload} />
  const history: ClinicSharedHistory = state.data

  if (!history.active) {
    return (
      <EmptyState
        icon={Lock}
        title="Este paciente não partilha o histórico."
        description={
          patient.vitaLink
            ? 'Peça-lhe que ative “Partilhar histórico” na app, no perfil, em “Clínicas e partilha”. Se já tinha partilhado, a partilha pode ter expirado ou sido retirada.'
            : 'Só os pacientes Vita ligados à clínica e com o consentimento ativo partilham a medicação e os exames.'
        }
        action={
          !patient.vitaLink &&
          !isDoctor && (
            <Button size="sm" variant="secondary" onClick={onLink} icon={<Link2 className="size-4" aria-hidden />}>
              Ligar paciente Vita
            </Button>
          )
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="flex items-start gap-2 rounded-xl bg-surface-muted px-3.5 py-3 text-sm">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
        <span>
          Partilhado pelo paciente, só para leitura
          {history.validUntil ? `, até ${formatLongDate(history.validUntil)}` : ''}. Medicação ativa e exames dos últimos
          24 meses. O que copiar passa a ser responsabilidade da clínica.
        </span>
      </p>
      <DetailSection title="Medicação ativa">
        {history.medications.length > 0 ? (
          <Card className="divide-y divide-border py-1">
            {history.medications.map((medication) => (
              <div key={`${medication.name}-${medication.startAt}`} className="py-3">
                <p className="font-medium">{medication.name}</p>
                <p className="text-sm text-muted">
                  {medication.dosage} · desde {formatShortDate(medication.startAt)}
                  {medication.continuous || !medication.endAt ? ' · uso contínuo' : ` · até ${formatShortDate(medication.endAt)}`}
                </p>
              </div>
            ))}
          </Card>
        ) : (
          <p className="text-sm text-muted">Sem medicação ativa.</p>
        )}
      </DetailSection>
      <DetailSection title="Exames">
        {history.examinations.length > 0 ? (
          <Card className="divide-y divide-border py-1">
            {history.examinations.map((exam) => (
              <div key={`${exam.name}-${exam.examDate}`} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{exam.name}</p>
                  <span className="text-sm text-muted">{formatShortDate(exam.examDate)}</span>
                </div>
                <p className="text-sm text-muted">{exam.status === 'SCHEDULED' ? 'Agendado' : 'Realizado'}</p>
                {exam.results.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-0.5 text-sm">
                    {exam.results.map((result) => (
                      <li key={result.parameter} className="flex justify-between gap-3">
                        <span>{result.parameter}</span>
                        <span className="tabular-nums">
                          {result.valueNumeric ?? result.valueText ?? '—'}
                          {result.unit ? ` ${result.unit}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </Card>
        ) : (
          <p className="text-sm text-muted">Sem exames.</p>
        )}
      </DetailSection>
    </div>
  )
}

/** Ficha do paciente da clínica (UC-CLN-14/17): resumo, atividade, recomendações e histórico partilhado. */
export function ClinicPatientPage() {
  const { id = '' } = useParams()
  const toast = useToast()
  const { state, reload } = useAsync(() => clinicPatientsService.getRecord(id), [id])
  const [tab, setTab] = useState<TabValue>('summary')
  const [editing, setEditing] = useState(false)
  const [linking, setLinking] = useState(false)
  const [booking, setBooking] = useState(false)

  return (
    <>
      <Link to={paths.clinicPatients} className="flex w-fit items-center gap-1.5 text-sm font-medium text-primary">
        <ArrowLeft className="size-4" aria-hidden />
        Pacientes
      </Link>

      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' &&
        (isAppError(state.error, 'NOT_FOUND') ? (
          <ErrorState message="Este paciente não existe na sua clínica." />
        ) : (
          <ErrorState onRetry={reload} />
        ))}
      {state.status === 'success' && (
        <PatientView
          record={state.data}
          tab={tab}
          onTab={setTab}
          onEdit={() => setEditing(true)}
          onLink={() => setLinking(true)}
          onBook={() => setBooking(true)}
          onChanged={reload}
        />
      )}

      {state.status === 'success' && editing && (
        <PatientFormModal
          patient={state.data.patient}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            toast.show('Paciente atualizado.')
            reload()
          }}
        />
      )}
      {state.status === 'success' && linking && (
        <LinkPatientModal
          clinicPatientId={state.data.patient.id}
          onClose={() => setLinking(false)}
          onLinked={() => {
            setLinking(false)
            toast.show('Paciente ligado.')
            reload()
          }}
        />
      )}
      {state.status === 'success' && booking && (
        <WalkInBookingModal
          initialPatient={{ id: state.data.patient.id, name: state.data.patient.name }}
          onClose={() => setBooking(false)}
          onBooked={() => {
            setBooking(false)
            toast.show('Consulta marcada.')
            setTab('activity')
            reload()
          }}
        />
      )}
    </>
  )
}

function PatientView({
  record,
  tab,
  onTab,
  onEdit,
  onLink,
  onBook,
  onChanged,
}: {
  record: ClinicPatientRecord
  tab: TabValue
  onTab: (tab: TabValue) => void
  onEdit: () => void
  onLink: () => void
  onBook: () => void
  onChanged: () => void
}) {
  const { patient } = record
  const { isDoctor } = useClinicAuth()
  const sharing = sharingLabel(patient)
  return (
    <>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={patient.name} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{patient.name}</h1>
          <div className="mt-1 flex flex-wrap gap-2">
            <Badge tone={sharing.tone}>{sharing.label}</Badge>
            <Badge>{patient.origin === 'VITA' ? 'Veio da Vita Family' : 'Criado na clínica'}</Badge>
          </div>
        </div>
        {!isDoctor && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onBook} icon={<CalendarPlus className="size-4" aria-hidden />}>
              Marcar consulta
            </Button>
            <Button size="sm" variant="secondary" onClick={onEdit} icon={<Pencil className="size-4" aria-hidden />}>
              Editar
            </Button>
          </div>
        )}
      </div>
      <Tabs items={TABS} value={tab} onChange={onTab} label="Secções da ficha" scrollable />
      <div role="tabpanel" className="max-w-3xl">
        {tab === 'summary' && <Summary patient={patient} onChanged={onChanged} onLink={onLink} />}
        {tab === 'activity' && <Activity record={record} onBook={onBook} onChanged={onChanged} />}
        {tab === 'recommendations' && <Recommendations record={record} />}
        {tab === 'shared' && <SharedHistory patient={patient} onLink={onLink} />}
      </div>
    </>
  )
}
