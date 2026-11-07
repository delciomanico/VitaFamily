import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Textarea'
import { FormError } from '@/components/ui/states'
import { todayISO } from '@/lib/date'
import { errorMessage } from '@/lib/errors'
import { clinicPatientsService } from '@/services/clinicPatients.service'
import { CLINIC_PATIENT_NOTES_MAX, type ClinicPatient } from '@/types/clinic'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_PATTERN = /^[+0-9 ()-]{5,30}$/

interface PatientFormModalProps {
  /** Ausente = novo paciente de balcão. */
  patient?: ClinicPatient
  onClose: () => void
  onSaved: (patient: ClinicPatient) => void
}

/**
 * Criar ou editar um paciente da clínica (UC-CLN-14, BR-CLN-17): só o nome é obrigatório.
 * O contacto é da clínica e nunca serve para procurar contas Vita.
 */
export function PatientFormModal({ patient, onClose, onSaved }: PatientFormModalProps) {
  const [name, setName] = useState(patient?.name ?? '')
  const [phone, setPhone] = useState(patient?.phone ?? '')
  const [email, setEmail] = useState(patient?.email ?? '')
  const [birthDate, setBirthDate] = useState(patient?.birthDate ?? '')
  const [notes, setNotes] = useState(patient?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function touch<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value)
      setError(null)
    }
  }

  async function save() {
    if (!name.trim()) return setError('Indique o nome do paciente.')
    if (name.trim().length > 120) return setError('O nome tem no máximo 120 caracteres.')
    if (phone.trim() && !PHONE_PATTERN.test(phone.trim())) return setError('Telefone inválido. Use só números, espaços, + ( ) e -.')
    if (email.trim() && !EMAIL_PATTERN.test(email.trim())) return setError('Introduza um e-mail válido ou deixe o campo vazio.')
    if (birthDate && birthDate > todayISO()) return setError('A data de nascimento não pode ser futura.')
    if (notes.length > CLINIC_PATIENT_NOTES_MAX) return setError(`As notas têm no máximo ${CLINIC_PATIENT_NOTES_MAX} caracteres.`)
    const input = {
      name,
      phone: phone.trim() || null,
      email: email.trim() || null,
      birthDate: birthDate || null,
      notes: notes.trim() || null,
    }
    setSaving(true)
    try {
      onSaved(
        patient
          ? await clinicPatientsService.updatePatient(patient.id, input)
          : await clinicPatientsService.createPatient(input),
      )
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={patient ? 'Editar paciente' : 'Novo paciente'}
      description="Registo da clínica. Não cria conta Vita Family."
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
      <div className="flex flex-col gap-4">
        <Input label="Nome" value={name} autoComplete="off" onChange={(e) => touch(setName)(e.target.value)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Telefone (opcional)" type="tel" value={phone} onChange={(e) => touch(setPhone)(e.target.value)} />
          <Input
            label="Data de nascimento (opcional)"
            type="date"
            max={todayISO()}
            value={birthDate}
            onChange={(e) => touch(setBirthDate)(e.target.value)}
          />
        </div>
        <Input label="E-mail (opcional)" type="email" value={email} onChange={(e) => touch(setEmail)(e.target.value)} />
        <Textarea
          label="Notas internas (opcional)"
          hint="Só a clínica as vê."
          value={notes}
          onChange={(e) => touch(setNotes)(e.target.value)}
        />
        <FormError message={error} />
      </div>
    </Modal>
  )
}
