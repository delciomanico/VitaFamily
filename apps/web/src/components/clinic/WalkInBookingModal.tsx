import { useEffect, useState } from 'react'
import { CheckCircle2, Plus, Search, UserRound } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Tabs } from '@/components/ui/Tabs'
import { Textarea } from '@/components/ui/Textarea'
import { FormError, LoadingState } from '@/components/ui/states'
import { useAsync } from '@/hooks/useAsync'
import { cn } from '@/lib/cn'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatRelativeDay, formatTime } from '@/lib/format'
import { PatientFormModal } from '@/pages/clinic/patients/PatientFormModal'
import { clinicPatientsService } from '@/services/clinicPatients.service'
import { clinicPortalService } from '@/services/clinicPortal.service'
import type { ClinicBooking, ClinicPatient } from '@/types/clinic'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NOTES_MAX = 2000
const SEARCH_DELAY_MS = 250

/** Paciente já identificado para a marcação: da clínica (id) ou conta Vita (e-mail exato). */
type Chosen = { kind: 'CLINIC'; id: string; name: string } | { kind: 'EMAIL'; email: string; name: string }

interface WalkInBookingModalProps {
  onClose: () => void
  onBooked: (booking: ClinicBooking) => void
  /** Abre já no passo do horário, com este paciente da clínica (ex.: a partir da ficha). */
  initialPatient?: { id: string; name: string }
  /** Abre já no passo do horário, com esta conta Vita (e-mail exato já confirmado). */
  initialEmail?: { email: string; name: string }
  /** Horário já escolhido (ex.: clicado no calendário). */
  initialSlotId?: string
}

/** Passo 2: horário livre da própria clínica; o paciente já está identificado. */
function SlotStep({
  patient,
  initialSlotId,
  onBack,
  onBooked,
}: {
  patient: Chosen
  initialSlotId?: string
  onBack: () => void
  onBooked: (booking: ClinicBooking) => void
}) {
  const { state } = useAsync(() => clinicPortalService.listSlots('APPOINTMENT'), [])
  const [slotId, setSlotId] = useState(initialSlotId ?? '')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const free = state.status === 'success' ? state.data.filter((slot) => slot.state === 'FREE') : []

  async function book() {
    if (!slotId) return setError('Escolha um horário livre.')
    if (notes.length > NOTES_MAX) return setError(`As observações têm no máximo ${NOTES_MAX} caracteres.`)
    setSaving(true)
    try {
      onBooked(
        await clinicPortalService.createWalkIn(
          patient.kind === 'EMAIL'
            ? { patientEmail: patient.email, slotId, notes }
            : { clinicPatientId: patient.id, slotId, notes },
        ),
      )
    } catch (err) {
      setError(
        isAppError(err, 'CONFLICT')
          ? 'Esse horário já não está livre ou o paciente tem outra consulta à mesma hora.'
          : isAppError(err, 'NOT_FOUND')
            ? 'O horário ou o paciente já não estão disponíveis. Volte atrás e confirme os dados.'
            : errorMessage(err),
      )
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onBack}
      title="Marcar consulta presencial"
      description={`Paciente: ${patient.name}`}
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
        {patient.kind === 'EMAIL' && (
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="size-4" aria-hidden />
            Paciente encontrado na Vita Family. Fica ligado à clínica com o consentimento “Marcações”.
          </p>
        )}
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

/** Escolha de um paciente da clínica por pesquisa (nome, telefone ou e-mail). */
function ClinicPatientPicker({ onPick }: { onPick: (patient: ClinicPatient) => void }) {
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setTerm(q.trim()), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [q])

  const searchable = term.length >= 2 || term.length === 0
  const { state } = useAsync(
    () => clinicPatientsService.listPatients({ q: term || undefined, limit: 6 }),
    [term],
  )
  const items = state.status === 'success' ? state.data.items : []

  return (
    <div className="flex flex-col gap-3">
      <Input
        label="Paciente da clínica"
        icon={Search}
        placeholder="Nome, telefone ou e-mail"
        autoComplete="off"
        value={q}
        onChange={(event) => setQ(event.target.value)}
      />
      {!searchable && <p className="text-sm text-muted">Escreva pelo menos 2 letras.</p>}
      {searchable && state.status === 'loading' && <LoadingState rows={2} />}
      {searchable && state.status === 'error' && <FormError message="Não foi possível pesquisar. Tente novamente." />}
      {searchable && state.status === 'success' && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {items.map((patient) => (
            <li key={patient.id}>
              <button
                type="button"
                onClick={() => onPick(patient)}
                className={cn('flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-muted')}
              >
                <UserRound className="size-4 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{patient.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {[patient.phone, patient.email].filter(Boolean).join(' · ') || 'Sem contacto'}
                  </span>
                </span>
                {patient.vitaLink && <Badge tone="primary">Vita</Badge>}
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="px-3 py-3 text-sm text-muted">Nenhum paciente encontrado.</li>}
        </ul>
      )}
      <Button variant="secondary" size="sm" onClick={() => setCreating(true)} icon={<Plus className="size-4" aria-hidden />}>
        Novo paciente
      </Button>
      {creating && (
        <PatientFormModal
          onClose={() => setCreating(false)}
          onSaved={(patient) => {
            setCreating(false)
            onPick(patient)
          }}
        />
      )}
    </div>
  )
}

/**
 * Marcação presencial (UC-CLN-08, BR-CLN-10/18): escolhe-se um paciente da clínica (pesquisa no
 * registo da própria clínica) ou procura-se o utilizador Vita pelo e-mail exato, e marca-se uma
 * consulta num horário livre. A resposta por e-mail só traz um nome de apresentação; a clínica
 * nunca vê ids nem outros dados da conta, e a mesma resposta serve para e-mail desconhecido.
 */
export function WalkInBookingModal({ onClose, onBooked, initialPatient, initialEmail, initialSlotId }: WalkInBookingModalProps) {
  const [mode, setMode] = useState<'CLINIC' | 'EMAIL'>('CLINIC')
  const [chosen, setChosen] = useState<Chosen | null>(
    initialPatient
      ? { kind: 'CLINIC', ...initialPatient }
      : initialEmail
        ? { kind: 'EMAIL', ...initialEmail }
        : null,
  )
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)

  async function search() {
    if (!EMAIL_PATTERN.test(email.trim())) return setError('Introduza o e-mail completo do paciente.')
    setSearching(true)
    try {
      const { displayName } = await clinicPortalService.lookupPatient(email)
      setChosen({ kind: 'EMAIL', email: email.trim(), name: displayName })
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

  if (chosen) {
    return (
      <SlotStep
        patient={chosen}
        initialSlotId={initialSlotId}
        onBack={initialPatient || initialEmail ? onClose : () => setChosen(null)}
        onBooked={onBooked}
      />
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Marcar consulta presencial"
      description="Escolha o paciente. Tem de estar presente na clínica."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          {mode === 'EMAIL' && (
            <Button onClick={() => void search()} loading={searching} icon={<Search className="size-4" aria-hidden />}>
              Procurar
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Tabs
          label="Tipo de paciente"
          value={mode}
          onChange={(value) => {
            setMode(value)
            setError(null)
          }}
          items={[
            { value: 'CLINIC', label: 'Paciente da clínica' },
            { value: 'EMAIL', label: 'Conta Vita (e-mail)' },
          ]}
        />
        {mode === 'CLINIC' ? (
          <ClinicPatientPicker onPick={(patient) => setChosen({ kind: 'CLINIC', id: patient.id, name: patient.name })} />
        ) : (
          <>
            <Input
              label="E-mail do paciente"
              type="email"
              autoComplete="off"
              placeholder="nome@exemplo.com"
              hint="O e-mail da conta Vita Family, exato."
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                setError(null)
              }}
            />
            <FormError message={error} />
          </>
        )}
      </div>
    </Modal>
  )
}
