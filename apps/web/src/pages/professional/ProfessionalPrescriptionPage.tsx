import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CircleSlash, Plus, Trash2 } from 'lucide-react'
import { ScheduleFields, emptySchedule, scheduleError, toScheduleInput, type ScheduleValue } from '@/components/domain/ScheduleFields'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { usePageTitle } from '@/hooks/usePageTitle'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatLongDate, formatShortDateLuanda } from '@/lib/format'
import { MAX_PRESCRIPTION_MEDICATIONS, PRESCRIPTION_NOTES_MAX, PRESCRIPTION_NOTICE, frequencyText } from '@/lib/recordSharing'
import { paths } from '@/routes/paths'
import { professionalBookingService } from '@/services/professionalBooking.service'
import { professionalShareService } from '@/services/professionalShare.service'
import type { ProfessionalPrescription, ProfessionalPrescriptionMedication } from '@/types/recordSharing'

interface Row {
  key: number
  name: string
  dosage: string
  schedule: ScheduleValue
  continuous: boolean
  durationDays: string
  notes: string
}

let rowKey = 0
const newRow = (): Row => ({ key: (rowKey += 1), name: '', dosage: '', schedule: emptySchedule(), continuous: false, durationDays: '7', notes: '' })

function atToday(time: string): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number)
  const date = new Date()
  date.setHours(hours, minutes, 0, 0)
  return date.toISOString()
}

/** Medicamento do formulário → `MedicationPlanInput` do contrato (texto livre, sem catálogo). */
function toMedication(row: Row): ProfessionalPrescriptionMedication {
  const schedule = toScheduleInput(row.schedule)
  let endAt: string | undefined
  if (!row.continuous) {
    const last = new Date()
    last.setDate(last.getDate() + Number(row.durationDays) - 1)
    last.setHours(23, 59, 0, 0)
    endAt = last.toISOString()
  }
  const base = { name: row.name.trim(), dosage: row.dosage.trim(), continuous: row.continuous, endAt, notes: row.notes.trim() || undefined }
  return schedule.scheduleType === 'FIXED_TIMES'
    ? { ...base, scheduleType: 'FIXED_TIMES', times: schedule.times, startAt: atToday('00:00') }
    : { ...base, scheduleType: 'INTERVAL', intervalHours: schedule.intervalHours, startAt: atToday(schedule.firstTime) }
}

function rowError(row: Row): string | null {
  if (!row.name.trim() || !row.dosage.trim()) return 'Indique o medicamento e a dosagem.'
  const schedule = scheduleError(row.schedule)
  if (schedule) return schedule
  const days = Number(row.durationDays)
  if (!row.continuous && !(Number.isInteger(days) && days >= 1 && days <= 365)) return 'Indique a duração em dias (1 a 365).'
  return null
}

/**
 * Receita digital da marcação (UC-MKT-59/60), só com a receita digital ligada: sem ela a API responde `404` e esta
 * página mostra que não está disponível (o botão para aqui nem aparece). O profissional só indica medicamentos e
 * observações; o servidor fixa a data, o nome, o membro e a origem.
 */
export function ProfessionalPrescriptionPage() {
  const { bookingId = '' } = useParams()
  usePageTitle('Receita')
  const booking = useAsync(() => professionalBookingService.get(bookingId), [bookingId])
  const existing = useAsync(
    () =>
      professionalShareService.getPrescription(bookingId).then(
        (value) => ({ value }),
        (error: unknown) => {
          if (isAppError(error, 'NOT_FOUND')) return { value: null }
          throw error
        },
      ),
    [bookingId],
  )
  const [issued, setIssued] = useState<ProfessionalPrescription | null>(null)
  const back = (
    <Link to={paths.professionalBooking(bookingId)} className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-primary">
      <ArrowLeft className="size-4" aria-hidden />
      Voltar à marcação
    </Link>
  )

  const loading = booking.state.status === 'loading' || existing.state.status === 'loading'
  const failed = booking.state.status === 'error' ? booking.state.error : existing.state.status === 'error' ? existing.state.error : null
  let body
  if (loading) body = <LoadingState rows={3} />
  else if (failed) body = isAppError(failed, 'NOT_FOUND') ? <EmptyState icon={CircleSlash} title="Marcação não encontrada." /> : <ErrorState message={errorMessage(failed)} onRetry={() => { booking.reload(); existing.reload() }} />
  else {
    const current = issued ?? (existing.state.status === 'success' ? existing.state.data.value : null)
    const canPrescribe = booking.state.status === 'success' && booking.state.data.canPrescribe === true
    if (current) body = <PrescriptionView prescription={current} />
    else if (canPrescribe) body = <PrescriptionForm bookingId={bookingId} onIssued={setIssued} />
    else body = <EmptyState icon={CircleSlash} title="Não é possível emitir receita nesta marcação." description="A receita digital não está disponível para esta marcação." />
  }

  return (
    <div className="flex flex-col gap-4">
      {back}
      <h1 className="text-xl font-semibold">Receita</h1>
      {body}
    </div>
  )
}

function PrescriptionView({ prescription }: { prescription: ProfessionalPrescription }) {
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-1">
        <p className="font-medium">Receita emitida em {formatLongDate(prescription.issuedOn)}</p>
        <p className="text-sm text-muted">Este é o que escreveu. A família só a pode ler: pode ajustar os horários dos lembretes, mas não alterar os medicamentos.</p>
      </Card>
      <Card className="flex flex-col divide-y divide-border py-1">
        {prescription.medications.map((m, index) => (
          <div key={index} className="flex flex-col gap-0.5 py-3">
            <p className="font-medium">
              {m.name} <span className="font-normal text-muted">{m.dosage}</span>
            </p>
            <p className="text-sm text-muted">
              {frequencyText(m)} · {m.continuous || !m.endAt ? 'Uso contínuo' : `Até ${formatShortDateLuanda(m.endAt)}`}
            </p>
            {m.notes && <p className="text-sm">{m.notes}</p>}
          </div>
        ))}
      </Card>
      {prescription.notes && (
        <Card>
          <p className="text-sm text-muted">Observações</p>
          <p className="whitespace-pre-line">{prescription.notes}</p>
        </Card>
      )}
    </div>
  )
}

function PrescriptionForm({ bookingId, onIssued }: { bookingId: string; onIssued: (value: ProfessionalPrescription) => void }) {
  const toast = useToast()
  const [rows, setRows] = useState<Row[]>(() => [newRow()])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const patch = (key: number, change: Partial<Row>) => setRows((current) => current.map((r) => (r.key === key ? { ...r, ...change } : r)))

  function review(event: FormEvent) {
    event.preventDefault()
    const first = rows.map(rowError).find(Boolean)
    if (first) return setError(first)
    if (notes.length > PRESCRIPTION_NOTES_MAX) return setError(`As observações têm no máximo ${PRESCRIPTION_NOTES_MAX} caracteres.`)
    setError(null)
    setConfirming(true)
  }

  async function issue() {
    setSending(true)
    try {
      const value = await professionalShareService.issuePrescription(bookingId, { notes: notes.trim() || undefined, medications: rows.map(toMedication) })
      toast.show('Receita emitida.')
      onIssued(value)
    } catch (e) {
      setConfirming(false)
      setError(isAppError(e, 'CONFLICT') ? 'Já existe uma receita nesta marcação.' : errorMessage(e))
      setSending(false)
    }
  }

  return (
    <form onSubmit={review} noValidate className="flex flex-col gap-5">
      <p role="note" className="rounded-md bg-warning-soft px-3.5 py-3 text-sm">
        {PRESCRIPTION_NOTICE}
      </p>
      {rows.map((row, index) => (
        <Card key={row.key} className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Medicamento {index + 1}</h2>
            {rows.length > 1 && (
              <Button variant="ghost" size="sm" onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))} icon={<Trash2 className="size-4" aria-hidden />}>
                Remover
              </Button>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Medicamento" value={row.name} maxLength={200} onChange={(event) => patch(row.key, { name: event.target.value })} />
            <Input label="Dosagem" value={row.dosage} maxLength={200} onChange={(event) => patch(row.key, { dosage: event.target.value })} />
          </div>
          <ScheduleFields value={row.schedule} onChange={(schedule) => patch(row.key, { schedule })} />
          <Checkbox label="Uso contínuo (sem data de fim)" checked={row.continuous} onChange={(event) => patch(row.key, { continuous: event.target.checked })} />
          {!row.continuous && <Input label="Duração (dias)" type="number" min={1} max={365} value={row.durationDays} onChange={(event) => patch(row.key, { durationDays: event.target.value })} className="sm:w-40" />}
          <Input label="Observações (opcional)" value={row.notes} maxLength={200} onChange={(event) => patch(row.key, { notes: event.target.value })} />
        </Card>
      ))}
      {rows.length < MAX_PRESCRIPTION_MEDICATIONS && (
        <Button variant="soft" className="w-fit" onClick={() => setRows((current) => [...current, newRow()])} icon={<Plus className="size-4" aria-hidden />}>
          Acrescentar medicamento
        </Button>
      )}
      <Textarea label="Observações da receita (opcional)" value={notes} maxLength={PRESCRIPTION_NOTES_MAX} onChange={(event) => setNotes(event.target.value)} hint={`${notes.length}/${PRESCRIPTION_NOTES_MAX} caracteres`} />
      <FormError message={error} />
      <Button type="submit" size="lg" className="sm:w-fit">
        Emitir receita
      </Button>
      <ConfirmDialog
        open={confirming}
        title="Emitir esta receita?"
        description="Depois de emitida, a receita fica no registo do membro e não pode ser alterada por si nem pela família."
        confirmLabel="Emitir"
        loading={sending}
        onConfirm={() => void issue()}
        onCancel={() => setConfirming(false)}
      />
    </form>
  )
}
