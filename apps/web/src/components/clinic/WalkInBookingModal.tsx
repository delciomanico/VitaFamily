import { useState } from 'react'
import { CheckCircle2, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { FormError, LoadingState } from '@/components/ui/states'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatRelativeDay, formatTime } from '@/lib/format'
import { clinicPortalService } from '@/services/clinicPortal.service'
import type { ClinicBooking } from '@/types/clinic'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NOTES_MAX = 2000

interface WalkInBookingModalProps {
  onClose: () => void
  onBooked: (booking: ClinicBooking) => void
}

/** Passo 2: horário livre da própria clínica; o paciente já está identificado. */
function SlotStep({
  patientName,
  email,
  onBack,
  onBooked,
}: {
  patientName: string
  email: string
  onBack: () => void
  onBooked: (booking: ClinicBooking) => void
}) {
  const { state } = useAsync(() => clinicPortalService.listSlots('APPOINTMENT'), [])
  const [slotId, setSlotId] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const free = state.status === 'success' ? state.data.filter((slot) => slot.state === 'FREE') : []

  async function book() {
    if (!slotId) return setError('Escolha um horário livre.')
    if (notes.length > NOTES_MAX) return setError(`As observações têm no máximo ${NOTES_MAX} caracteres.`)
    setSaving(true)
    try {
      onBooked(await clinicPortalService.createWalkIn({ patientEmail: email, slotId, notes }))
    } catch (err) {
      setError(
        isAppError(err, 'CONFLICT')
          ? 'Esse horário já não está livre ou o paciente tem outra consulta à mesma hora.'
          : isAppError(err, 'NOT_FOUND')
            ? 'O horário ou o paciente já não estão disponíveis. Volte atrás e confirme os dados.'
            : errorMessage(err),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onBack}
      title="Marcar consulta presencial"
      description={`Paciente: ${patientName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onBack}>
            Voltar
          </Button>
          <Button onClick={() => void book()} loading={saving}>
            Marcar consulta
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="size-4" aria-hidden />
          Paciente encontrado na Vita Family.
        </p>
        {state.status === 'loading' && <LoadingState rows={2} />}
        {state.status === 'success' && (
          <Select
            label="Horário livre"
            placeholder={free.length > 0 ? 'Escolha um horário' : 'Sem horários livres'}
            value={slotId}
            options={free.map((slot) => ({
              value: slot.id,
              label: `${formatRelativeDay(slot.startsAt)} ${formatTime(slot.startsAt)} · ${slot.specialty}${
                slot.professionalName ? ` · ${slot.professionalName}` : ''
              }`,
            }))}
            onChange={(event) => {
              setSlotId(event.target.value)
              setError(null)
            }}
          />
        )}
        <Textarea
          label="Observações (opcional)"
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value)
            setError(null)
          }}
        />
        <FormError message={error} />
      </div>
    </Modal>
  )
}

/**
 * Marcação presencial (UC-CLN-08, ADR-024): o Gestor procura o utilizador Vita pelo e-mail exato e
 * marca-lhe uma consulta num horário livre. A resposta só traz um nome de apresentação; a clínica
 * nunca vê ids nem outros dados da conta. A mesma resposta serve para e-mail desconhecido,
 * suspenso ou sem perfil, para não revelar que contas existem.
 */
export function WalkInBookingModal({ onClose, onBooked }: WalkInBookingModalProps) {
  const [email, setEmail] = useState('')
  const [patientName, setPatientName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)

  async function search() {
    if (!EMAIL_PATTERN.test(email.trim())) return setError('Introduza o e-mail completo do paciente.')
    setSearching(true)
    try {
      setPatientName((await clinicPortalService.lookupPatient(email)).displayName)
    } catch (err) {
      setError(
        isAppError(err, 'NOT_FOUND')
          ? 'Não encontrámos um paciente com esse e-mail. Confirme o e-mail com o paciente.'
          : isAppError(err, 'RATE_LIMITED')
            ? 'Fez demasiadas pesquisas. Tente mais tarde.'
            : errorMessage(err),
      )
    } finally {
      setSearching(false)
    }
  }

  if (patientName) {
    return (
      <SlotStep
        patientName={patientName}
        email={email}
        onBack={() => setPatientName(null)}
        onBooked={onBooked}
      />
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Marcar consulta presencial"
      description="Procure o paciente pelo e-mail da conta Vita Family. Tem de estar presente na clínica."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button onClick={() => void search()} loading={searching} icon={<Search className="size-4" aria-hidden />}>
            Procurar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="E-mail do paciente"
          type="email"
          autoComplete="off"
          placeholder="nome@exemplo.com"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
            setError(null)
          }}
        />
        <FormError message={error} />
      </div>
    </Modal>
  )
}
