import { useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { CircleAlert } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select, type SelectOption } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { ErrorState, FormError } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage } from '@/lib/errors'
import { CHAT_MAX_LENGTH, CHAT_WARNING, PARTICIPANT_LABEL_MAX, validMessageText } from '@/lib/marketplace'
import { paths } from '@/routes/paths'
import { conversationService, type MessagingMember } from '@/services/conversation.service'

interface StartConversationModalProps {
  open: boolean
  onClose: () => void
  professional: { id: string; displayName: string }
}

/** Abre a primeira mensagem a um profissional, em nome de um membro da família. Texto nunca vai para logs (BR-MKT-46). */
export function StartConversationModal({ open, onClose, professional }: StartConversationModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={`Escrever para ${professional.displayName}`}>
      {/* Montado só com o modal aberto: cada abertura começa com campos e clientMessageId novos. */}
      {open && <StartConversationForm onClose={onClose} professional={professional} />}
    </Modal>
  )
}

interface FormProps {
  onClose: () => void
  professional: { id: string; displayName: string }
}

interface FieldErrors {
  member?: string
  label?: string
  text?: string
}

/** Primeiro nome, cortado ao limite do rótulo; usado como sugestão de «Como quer ser tratado/a». */
function firstName(name: string): string {
  return (name.trim().split(/\s+/)[0] ?? '').slice(0, PARTICIPANT_LABEL_MAX)
}

function StartConversationForm({ onClose, professional }: FormProps) {
  const { user, family } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(() => conversationService.eligibleMembers(familyId, userId), [familyId, userId])

  // Gerado uma vez por abertura: um reenvio com o mesmo id não duplica a mensagem (envio idempotente).
  const clientMessageIdRef = useRef(crypto.randomUUID())
  const [pickedId, setPickedId] = useState('')
  const [labelDraft, setLabelDraft] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const members: MessagingMember[] = state.status === 'success' ? state.data : []
  // Com um único membro elegível, pré-seleciona-o.
  const memberId = pickedId || (members.length === 1 ? (members[0]?.id ?? '') : '')
  const member = members.find((item) => item.id === memberId)
  const participantLabel = labelDraft ?? firstName(member?.name ?? '')

  const memberOptions: SelectOption[] = members.map((item) => ({
    value: item.id,
    label: item.isSelf ? `${item.name} (eu)` : item.name,
  }))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending) return

    const label = participantLabel.trim()
    const message = validMessageText(text)
    const next: FieldErrors = {}
    if (!member) next.member = 'Escolha para quem é a mensagem.'
    if (label.length < 1 || label.length > PARTICIPANT_LABEL_MAX) {
      next.label = `Indique como quer ser tratado/a (até ${PARTICIPANT_LABEL_MAX} caracteres).`
    }
    if (!message) next.text = `Escreva a mensagem (até ${CHAT_MAX_LENGTH} caracteres).`
    setErrors(next)
    setFormError(null)
    if (!member || !message || Object.keys(next).length > 0) return

    setSending(true)
    try {
      const started = await conversationService.start(familyId, userId, member.id, {
        professionalId: professional.id,
        participantLabel: label,
        text: message,
        clientMessageId: clientMessageIdRef.current,
      })
      toast.show('Mensagem enviada.')
      navigate(paths.messageThread(member.id, started.conversation.id))
    } catch (error) {
      setFormError(errorMessage(error))
      setSending(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
      <div role="note" className="flex items-start gap-2 rounded-md bg-warning-soft px-3.5 py-3 text-sm text-foreground">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <span>{CHAT_WARNING}</span>
      </div>

      {state.status === 'loading' && (
        <p role="status" className="text-sm text-muted">
          A carregar…
        </p>
      )}
      {state.status === 'error' && <ErrorState message={errorMessage(state.error)} onRetry={reload} />}
      {state.status === 'success' && members.length === 0 && <FormError message="Não pode escrever em nome de ninguém desta família." />}

      {members.length > 0 && (
        <>
          <Select
            label="Para quem?"
            options={memberOptions}
            placeholder={members.length > 1 ? 'Escolha uma pessoa' : undefined}
            value={memberId}
            onChange={(event) => setPickedId(event.target.value)}
            error={errors.member}
          />
          <Input
            label="Como quer ser tratado/a"
            value={participantLabel}
            onChange={(event) => setLabelDraft(event.target.value)}
            maxLength={PARTICIPANT_LABEL_MAX}
            hint={`Até ${PARTICIPANT_LABEL_MAX} caracteres. É o nome que o profissional vê nesta conversa.`}
            error={errors.label}
            autoComplete="off"
          />
          <Textarea
            label="Primeira mensagem"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={CHAT_MAX_LENGTH}
            rows={5}
            hint={`${text.length}/${CHAT_MAX_LENGTH} caracteres`}
            error={errors.text}
          />
          <FormError message={formError} />
        </>
      )}

      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        {members.length > 0 && (
          <Button type="submit" loading={sending}>
            Enviar
          </Button>
        )}
      </div>
    </form>
  )
}
