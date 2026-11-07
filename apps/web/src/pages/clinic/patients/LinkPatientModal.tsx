import { useState } from 'react'
import { CheckCircle2, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Tabs } from '@/components/ui/Tabs'
import { FormError } from '@/components/ui/states'
import { errorMessage, isAppError } from '@/lib/errors'
import { clinicPatientsService } from '@/services/clinicPatients.service'
import { clinicPortalService } from '@/services/clinicPortal.service'
import type { ClinicPatient } from '@/types/clinic'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
type Mode = 'code' | 'email'

interface LinkPatientModalProps {
  /** Liga este paciente existente em vez de criar um novo (só por código, BR-CLN-20). */
  clinicPatientId?: string
  onClose: () => void
  onLinked: (patient: ClinicPatient) => void
  /** Paciente Vita confirmado pelo e-mail exato: segue para marcar consulta (que cria a ligação, BR-CLN-18). */
  onBookWithEmail?: (email: string, displayName: string) => void
}

/**
 * Ligar um paciente Vita à clínica (UC-CLN-15): com o código de 8 caracteres que ele gera na app
 * (ou o QR), ou — na lista — pelo e-mail exato da conta, que liga ao marcar a primeira consulta.
 * Nunca se pesquisa a base Vita por nome.
 */
export function LinkPatientModal({ clinicPatientId, onClose, onLinked, onBookWithEmail }: LinkPatientModalProps) {
  const canEmail = !clinicPatientId && onBookWithEmail !== undefined
  const [mode, setMode] = useState<Mode>('code')
  const [codeText, setCodeText] = useState('')
  const [email, setEmail] = useState('')
  const [found, setFound] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function link() {
    const code = codeText.replace(/[\s-]/g, '').toUpperCase()
    if (code.length !== 8) return setError('O código tem 8 caracteres (ex.: K7M2-9QXP).')
    setBusy(true)
    try {
      onLinked(await clinicPatientsService.linkPatient({ code, clinicPatientId }))
    } catch (err) {
      setError(
        isAppError(err, 'NOT_FOUND')
          ? 'Código inválido, expirado ou já usado. Peça ao paciente um código novo.'
          : isAppError(err, 'CONFLICT')
            ? 'Este paciente ou esta pessoa já estão ligados a outro registo da clínica.'
            : isAppError(err, 'RATE_LIMITED')
              ? 'Fez demasiadas tentativas. Tente mais tarde.'
              : errorMessage(err),
      )
      setBusy(false)
    }
  }

  async function lookup() {
    if (!EMAIL_PATTERN.test(email.trim())) return setError('Introduza o e-mail completo da conta do paciente.')
    setBusy(true)
    try {
      setFound((await clinicPortalService.lookupPatient(email)).displayName)
    } catch (err) {
      setError(
        isAppError(err, 'NOT_FOUND')
          ? 'Não encontrámos um paciente com esse e-mail. Confirme o e-mail com o paciente.'
          : isAppError(err, 'RATE_LIMITED')
            ? 'Fez demasiadas pesquisas. Tente mais tarde.'
            : errorMessage(err),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Ligar paciente Vita"
      description="O paciente tem de estar presente e dar o consentimento na app."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          {mode === 'code' && (
            <Button onClick={() => void link()} loading={busy}>
              Ligar
            </Button>
          )}
          {mode === 'email' && !found && (
            <Button onClick={() => void lookup()} loading={busy} icon={<Search className="size-4" aria-hidden />}>
              Procurar
            </Button>
          )}
          {mode === 'email' && found && (
            <Button onClick={() => onBookWithEmail?.(email.trim(), found)}>Marcar consulta</Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {canEmail && (
          <Tabs
            label="Forma de ligação"
            value={mode}
            onChange={(value) => {
              setMode(value)
              setError(null)
            }}
            items={[
              { value: 'code', label: 'Por código' },
              { value: 'email', label: 'Por e-mail' },
            ]}
          />
        )}
        {mode === 'code' ? (
          <Input
            label="Código do paciente"
            hint="O paciente gera-o na app, no seu perfil, em “Clínicas e partilha”. Vale 10 minutos."
            autoComplete="off"
            autoCapitalize="characters"
            maxLength={9}
            placeholder="XXXX-XXXX"
            value={codeText}
            onChange={(event) => {
              setCodeText(event.target.value)
              setError(null)
            }}
          />
        ) : found ? (
          <p className="flex items-start gap-2 text-sm text-success">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Paciente encontrado: <strong>{found}</strong>. A ligação fica feita ao marcar a primeira consulta.
            </span>
          </p>
        ) : (
          <Input
            label="E-mail da conta Vita do paciente"
            type="email"
            autoComplete="off"
            placeholder="nome@exemplo.com"
            hint="Tem de ser o e-mail exato."
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setError(null)
            }}
          />
        )}
        <FormError message={error} />
      </div>
    </Modal>
  )
}
