import { useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { controlClasses, controlState } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Switch } from '@/components/ui/Switch'
import { Textarea } from '@/components/ui/Textarea'
import { FormError } from '@/components/ui/states'
import { cn } from '@/lib/cn'
import { todayISO } from '@/lib/date'
import { errorMessage } from '@/lib/errors'
import { formatTime } from '@/lib/format'
import { clinicPortalService } from '@/services/clinicPortal.service'
import type { ClinicBooking, ClinicPrescriptionMedicationInput } from '@/types/clinic'

/** Duração máxima aceite no formulário; acima disso, usar “uso contínuo”. */
const MAX_DURATION_DAYS = 365

/**
 * Medicamento no formulário. A receita emitida pela clínica usa **horários fixos**
 * (`scheduleType=FIXED_TIMES`): é o essencial de uma receita no momento da consulta; a família
 * pode depois ajustar o plano na app, onde existe também o modo “de X em X horas”.
 */
interface MedicationRow {
  name: string
  dosage: string
  times: string[]
  continuous: boolean
  durationDays: string
  notes: string
}

const newMedication = (): MedicationRow => ({
  name: '',
  dosage: '',
  times: ['08:00'],
  continuous: false,
  durationDays: '7',
  notes: '',
})

/** Horas de uma toma: lista editável de `input[type=time]` (mesmo padrão de `ScheduleFields`). */
function TimesField({
  times,
  error,
  onChange,
}: {
  times: string[]
  error?: string
  onChange: (times: string[]) => void
}) {
  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label="Horários">
      <span className="text-sm font-medium">Horários</span>
      <ul className="flex flex-wrap gap-2">
        {times.map((time, index) => (
          <li key={index} className="relative">
            <input
              type="time"
              value={time}
              aria-label={`Horário ${index + 1}`}
              onChange={(event) => onChange(times.map((t, i) => (i === index ? event.target.value : t)))}
              className={cn(controlClasses, controlState(error), 'h-11 w-34 tabular-nums', times.length > 1 && 'pr-10')}
            />
            {times.length > 1 && (
              <button
                type="button"
                onClick={() => onChange(times.filter((_, i) => i !== index))}
                aria-label={`Remover horário ${index + 1}`}
                className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-border"
              >
                <X className="size-4" aria-hidden />
              </button>
            )}
          </li>
        ))}
        <li>
          <Button
            variant="soft"
            className="h-11"
            onClick={() => onChange([...times, ''])}
            icon={<Plus className="size-4" aria-hidden />}
          >
            Horário
          </Button>
        </li>
      </ul>
    </div>
  )
}

interface CompleteConsultationFormProps {
  booking: ClinicBooking
  onClose: () => void
  onCompleted: () => void
}

/**
 * Completar a consulta em curso (`PUT /clinic-portal/agenda/{id}/complete`, D18/BR-CLN-06):
 * marca REALIZADA, registra o resultado e, se a clínica quiser, emite a receita — que nasce com
 * `issuedBy=CLINIC` e passa a aparecer no histórico e nas receitas do paciente (BR-RX-07).
 *
 * Minimização de dados (BR-CLN-03): a clínica escreve sobre esta consulta, mas continua sem ver
 * condições, alergias, medicação prévia nem o histórico do paciente.
 */
export function CompleteConsultationForm({ booking, onClose, onCompleted }: CompleteConsultationFormProps) {
  const [outcomeNote, setOutcomeNote] = useState('')
  const [withPrescription, setWithPrescription] = useState(false)
  const [doctorName, setDoctorName] = useState(booking.professionalName ?? '')
  const [prescriptionNotes, setPrescriptionNotes] = useState('')
  const [medications, setMedications] = useState<MedicationRow[]>([newMedication()])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const setMedication = (index: number, patch: Partial<MedicationRow>) => {
    setMedications((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
    setError(null)
  }

  /** Valida e constrói os medicamentos; `null` em caso de erro (mensagem já mostrada). */
  function buildMedications(): ClinicPrescriptionMedicationInput[] | null {
    const built: ClinicPrescriptionMedicationInput[] = []
    for (const [index, row] of medications.entries()) {
      const position = `medicamento ${index + 1}`
      if (!row.name.trim() || !row.dosage.trim()) {
        setError(`Indique o nome e a dosagem do ${position}.`)
        return null
      }
      const times = row.times.filter(Boolean)
      if (times.length === 0 || times.length !== row.times.length || new Set(times).size !== times.length) {
        setError(`Verifique os horários do ${position}.`)
        return null
      }
      const days = Number(row.durationDays)
      if (!row.continuous && !(Number.isInteger(days) && days >= 1 && days <= MAX_DURATION_DAYS)) {
        setError(`Indique a duração em dias (1 a ${MAX_DURATION_DAYS}) do ${position}.`)
        return null
      }
      built.push({
        name: row.name.trim(),
        dosage: row.dosage.trim(),
        times: [...times].sort(),
        ...(row.continuous ? {} : { durationDays: days }),
        ...(row.notes.trim() ? { notes: row.notes.trim() } : {}),
      })
    }
    return built
  }

  async function submit() {
    if (!outcomeNote.trim() && !withPrescription) {
      return setError('Escreva o resultado da consulta ou emita uma receita.')
    }
    let prescriptionMedications: ClinicPrescriptionMedicationInput[] | null = null
    if (withPrescription) {
      prescriptionMedications = buildMedications()
      if (!prescriptionMedications) return
    }

    setSaving(true)
    try {
      await clinicPortalService.completeAppointment(booking.id, {
        ...(outcomeNote.trim() ? { outcomeNote: outcomeNote.trim() } : {}),
        ...(prescriptionMedications
          ? {
              prescription: {
                issuedOn: todayISO(),
                ...(doctorName.trim() ? { doctorName: doctorName.trim() } : {}),
                ...(prescriptionNotes.trim() ? { notes: prescriptionNotes.trim() } : {}),
                medications: prescriptionMedications,
              },
            }
          : {}),
      })
      onCompleted()
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
      title="Completar consulta"
      description={`${booking.patientName} · ${formatTime(booking.scheduledAt)}${
        booking.specialty ? ` · ${booking.specialty}` : ''
      }`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            Concluir consulta
          </Button>
        </>
      }
    >
      <div className="flex max-h-[60dvh] flex-col gap-4 overflow-y-auto pr-1">
        <Textarea
          label="Resultado da consulta"
          placeholder="Ex.: dermatite de contacto; evitar o produto e aplicar creme 7 dias."
          value={outcomeNote}
          onChange={(event) => {
            setOutcomeNote(event.target.value)
            setError(null)
          }}
        />

        <Switch
          label="Emitir receita"
          description="A receita fica disponível no histórico e nas receitas do paciente."
          checked={withPrescription}
          onChange={(checked) => {
            setWithPrescription(checked)
            setError(null)
          }}
        />

        {withPrescription && (
          <>
            <Input
              label="Médico (opcional)"
              placeholder="Ex.: Dr.ª Inês Lima"
              value={doctorName}
              onChange={(event) => setDoctorName(event.target.value)}
            />
            {medications.map((medication, index) => (
              <Card key={index} className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold">Medicamento {index + 1}</h3>
                  {medications.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setMedications((rows) => rows.filter((_, i) => i !== index))}
                      icon={<Trash2 className="size-4" aria-hidden />}
                    >
                      Remover
                    </Button>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Nome"
                    placeholder="Ex.: Amoxicilina"
                    value={medication.name}
                    onChange={(event) => setMedication(index, { name: event.target.value })}
                  />
                  <Input
                    label="Dosagem"
                    placeholder="Ex.: 500 mg"
                    value={medication.dosage}
                    onChange={(event) => setMedication(index, { dosage: event.target.value })}
                  />
                </div>
                <TimesField times={medication.times} onChange={(times) => setMedication(index, { times })} />
                <Switch
                  label="Uso contínuo"
                  description="Sem data de fim (ex.: medicação crónica)."
                  checked={medication.continuous}
                  onChange={(continuous) => setMedication(index, { continuous })}
                />
                {!medication.continuous && (
                  <Input
                    label="Duração (dias)"
                    type="number"
                    min={1}
                    max={MAX_DURATION_DAYS}
                    value={medication.durationDays}
                    onChange={(event) => setMedication(index, { durationDays: event.target.value })}
                  />
                )}
                <Input
                  label="Observações (opcional)"
                  placeholder="Ex.: tomar depois das refeições"
                  value={medication.notes}
                  onChange={(event) => setMedication(index, { notes: event.target.value })}
                />
              </Card>
            ))}
            <Button
              variant="soft"
              onClick={() => setMedications((rows) => [...rows, newMedication()])}
              icon={<Plus className="size-4" aria-hidden />}
            >
              Outro medicamento
            </Button>
            <Textarea
              label="Notas da receita (opcional)"
              value={prescriptionNotes}
              onChange={(event) => setPrescriptionNotes(event.target.value)}
            />
          </>
        )}

        <FormError message={error} />
      </div>
    </Modal>
  )
}
