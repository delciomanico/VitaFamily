import { useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { CircleSlash, Pencil, Plus } from 'lucide-react'
import { SheetNotice, SheetWait, WizardSheet } from '@/components/app/FormSheet'
import { ConfirmSheet } from '@/components/app/Sheet'
import { ScheduleFields, emptySchedule, scheduleError, toScheduleInput, type ScheduleValue } from '@/components/domain/ScheduleFields'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useDraft } from '@/lib/draft'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatLongDate, formatShortDateLuanda } from '@/lib/format'
import { useModalRoute, type ModalOutletContext } from '@/lib/modalRoute'
import { MAX_PRESCRIPTION_MEDICATIONS, PRESCRIPTION_NOTES_MAX, PRESCRIPTION_NOTICE, frequencyText } from '@/lib/recordSharing'
import { paths } from '@/routes/paths'
import { professionalBookingService } from '@/services/professionalBooking.service'
import { professionalShareService } from '@/services/professionalShare.service'
import type { ProfessionalPrescription, ProfessionalPrescriptionMedication } from '@/types/recordSharing'

interface Row {
  name: string
  dosage: string
  schedule: ScheduleValue
  continuous: boolean
  durationDays: string
  notes: string
}

const newRow = (): Row => ({ name: '', dosage: '', schedule: emptySchedule(), continuous: false, durationDays: '7', notes: '' })

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

/** Erro humano de cada parte de um medicamento (ou `null`). */
function nameError(row: Row): string | null {
  return !row.name.trim() || !row.dosage.trim() ? 'Indique o medicamento e a dosagem.' : null
}
function durationError(row: Row): string | null {
  const days = Number(row.durationDays)
  return !row.continuous && !(Number.isInteger(days) && days >= 1 && days <= 365) ? 'Indique a duração em dias (1 a 365).' : null
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
  const { close } = useModalRoute(paths.professionalBooking(bookingId))
  const context = useOutletContext<ModalOutletContext | null>()

  const loading = booking.state.status === 'loading' || existing.state.status === 'loading'
  const failed = booking.state.status === 'error' ? booking.state.error : existing.state.status === 'error' ? existing.state.error : null
  if (loading) return <SheetWait title="Receita" onClose={close} />
  if (failed)
    return (
      <SheetNotice title="Receita" onClose={close} closeLabel="Fechar">
        {isAppError(failed, 'NOT_FOUND') ? <EmptyState icon={CircleSlash} title="Marcação não encontrada." /> : <ErrorState message={errorMessage(failed)} onRetry={() => { booking.reload(); existing.reload() }} />}
      </SheetNotice>
    )

  const current = issued ?? (existing.state.status === 'success' ? existing.state.data.value : null)
  const canPrescribe = booking.state.status === 'success' && booking.state.data.canPrescribe === true
  if (current)
    return (
      <SheetNotice title="Receita" onClose={close} closeLabel="Fechar">
        <PrescriptionView prescription={current} />
      </SheetNotice>
    )
  if (canPrescribe)
    return (
      <PrescriptionWizard
        bookingId={bookingId}
        onIssued={(value) => {
          context?.onSaved?.()
          setIssued(value)
        }}
        onClose={close}
      />
    )
  return (
    <SheetNotice title="Receita" onClose={close} closeLabel="Fechar">
      <EmptyState icon={CircleSlash} title="Não é possível emitir receita nesta marcação." description="A receita digital não está disponível para esta marcação." />
    </SheetNotice>
  )
}

function PrescriptionView({ prescription }: { prescription: ProfessionalPrescription }) {
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4 shadow-card">
        <p className="text-lg font-semibold">Receita emitida em {formatLongDate(prescription.issuedOn)}</p>
        <p className="text-base text-muted">Isto é o que escreveu. A família só a pode ler: pode ajustar os horários dos lembretes, mas não mudar os medicamentos.</p>
      </section>
      <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-surface px-4 shadow-card">
        {prescription.medications.map((m, index) => (
          <li key={index} className="flex flex-col gap-0.5 py-3">
            <p className="text-lg font-semibold">
              {m.name} <span className="font-normal text-muted">{m.dosage}</span>
            </p>
            <p className="text-base text-muted">
              {frequencyText(m)} · {m.continuous || !m.endAt ? 'Uso contínuo' : `Até ${formatShortDateLuanda(m.endAt)}`}
            </p>
            {m.notes && <p className="text-base">{m.notes}</p>}
          </li>
        ))}
      </ul>
      {prescription.notes && (
        <section className="rounded-2xl border border-border bg-surface p-4 shadow-card">
          <p className="text-base text-muted">Observações</p>
          <p className="text-base whitespace-pre-line">{prescription.notes}</p>
        </section>
      )}
    </div>
  )
}

type Phase = 'name' | 'schedule' | 'duration' | 'review' | 'notes'
const PHASES: Phase[] = ['name', 'schedule', 'duration', 'review', 'notes']

/** Emitir a receita passo a passo: por medicamento (nome, horário, duração), rever e observações. */
function PrescriptionWizard({ bookingId, onIssued, onClose }: { bookingId: string; onIssued: (value: ProfessionalPrescription) => void; onClose: () => void }) {
  const toast = useToast()
  const [draft, update, clearDraft] = useDraft<{ rows: Row[]; notes: string }>(`prescription-${bookingId}`, { rows: [newRow()], notes: '' })
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('name')
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const rows = draft.rows
  const row = rows[index] ?? rows[0] ?? newRow()
  const patch = (change: Partial<Row>) => {
    setError(null)
    update({ rows: rows.map((r, i) => (i === index ? { ...r, ...change } : r)) })
  }

  function onBack() {
    setError(null)
    if (phase === 'name') return index > 0 ? setPhase('review') : onClose()
    setPhase(PHASES[PHASES.indexOf(phase) - 1] ?? 'name')
  }

  function onNext() {
    if (phase === 'name') {
      const problem = nameError(row)
      if (problem) return setError(problem)
    }
    if (phase === 'schedule') {
      const problem = scheduleError(row.schedule)
      if (problem) return setError(problem)
    }
    if (phase === 'duration') {
      const problem = durationError(row)
      if (problem) return setError(problem)
    }
    if (phase === 'notes') {
      if (draft.notes.length > PRESCRIPTION_NOTES_MAX) return setError(`As observações têm no máximo ${PRESCRIPTION_NOTES_MAX} caracteres.`)
      return setConfirming(true)
    }
    setError(null)
    setPhase(PHASES[PHASES.indexOf(phase) + 1] ?? 'notes')
  }

  async function issue() {
    setSending(true)
    try {
      const value = await professionalShareService.issuePrescription(bookingId, { notes: draft.notes.trim() || undefined, medications: rows.map(toMedication) })
      clearDraft()
      toast.show('Receita emitida.')
      onIssued(value)
    } catch (e) {
      setConfirming(false)
      setError(isAppError(e, 'CONFLICT') ? 'Já existe uma receita nesta marcação.' : errorMessage(e))
      setSending(false)
    }
  }

  const step = PHASES.indexOf(phase)
  const medTitle = rows.length > 1 ? ` ${index + 1}` : ''
  const titles: Record<Phase, string> = {
    name: `Medicamento${medTitle}`,
    schedule: 'Quando toma?',
    duration: 'Durante quanto tempo?',
    review: 'Reveja a receita',
    notes: 'Alguma observação?',
  }

  return (
    <>
      <WizardSheet
        onClose={onClose}
        onDiscard={clearDraft}
        dirty={JSON.stringify(draft) !== JSON.stringify({ rows: [newRow()], notes: '' })}
        title="Emitir receita"
        stepTitle={titles[phase]}
        description={phase === 'name' ? 'Escreva o nome e a dose, como na receita em papel.' : phase === 'notes' ? 'Opcional. A família vê isto junto à receita.' : undefined}
        step={step}
        total={PHASES.length}
        onBack={onBack}
        onNext={onNext}
        nextLabel={phase === 'notes' ? 'Emitir receita' : 'Continuar'}
        busy={sending}
        error={error}
      >
        {phase === 'name' && (
          <>
            {index === 0 && (
              <p role="note" className="rounded-xl bg-warning-soft px-4 py-3 text-base">
                {PRESCRIPTION_NOTICE}
              </p>
            )}
            <Input label="Medicamento" value={row.name} maxLength={200} onChange={(event) => patch({ name: event.target.value })} />
            <Input label="Dosagem" value={row.dosage} maxLength={200} onChange={(event) => patch({ dosage: event.target.value })} />
            <Input label="Observações do medicamento (opcional)" value={row.notes} maxLength={200} onChange={(event) => patch({ notes: event.target.value })} />
          </>
        )}
        {phase === 'schedule' && <ScheduleFields value={row.schedule} onChange={(schedule) => patch({ schedule })} />}
        {phase === 'duration' && (
          <>
            <Checkbox label="Uso contínuo (sem data de fim)" checked={row.continuous} onChange={(event) => patch({ continuous: event.target.checked })} />
            {!row.continuous && <Input label="Duração (dias)" type="number" min={1} max={365} value={row.durationDays} onChange={(event) => patch({ durationDays: event.target.value })} />}
          </>
        )}
        {phase === 'review' && (
          <>
            <ul className="flex flex-col gap-3">
              {rows.map((r, i) => (
                <li key={i} className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
                  <div className="min-w-0">
                    <p className="text-lg font-semibold">
                      {r.name || 'Sem nome'} <span className="font-normal text-muted">{r.dosage}</span>
                    </p>
                    <p className="text-base text-muted">{r.continuous ? 'Uso contínuo' : `${r.durationDays} dias`}</p>
                  </div>
                  <Button
                    variant="soft"
                    icon={<Pencil className="size-4" aria-hidden />}
                    aria-label={`Mudar o medicamento ${r.name || i + 1}`}
                    onClick={() => {
                      setIndex(i)
                      setPhase('name')
                    }}
                  >
                    Mudar
                  </Button>
                </li>
              ))}
            </ul>
            {rows.length < MAX_PRESCRIPTION_MEDICATIONS && (
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                icon={<Plus className="size-5" aria-hidden />}
                onClick={() => {
                  update({ rows: [...rows, newRow()] })
                  setIndex(rows.length)
                  setPhase('name')
                }}
              >
                Acrescentar outro medicamento
              </Button>
            )}
          </>
        )}
        {phase === 'notes' && <Textarea label="Observações da receita (opcional)" rows={5} value={draft.notes} maxLength={PRESCRIPTION_NOTES_MAX} onChange={(event) => { setError(null); update({ notes: event.target.value }) }} hint={`${draft.notes.length}/${PRESCRIPTION_NOTES_MAX} letras`} />}
      </WizardSheet>
      <ConfirmSheet
        open={confirming}
        title="Emitir esta receita?"
        description="Depois de emitida, a receita fica no registo do membro e não pode ser alterada por si nem pela família."
        yesLabel="Sim, emitir"
        loading={sending}
        onYes={() => void issue()}
        onNo={() => setConfirming(false)}
      />
    </>
  )
}
