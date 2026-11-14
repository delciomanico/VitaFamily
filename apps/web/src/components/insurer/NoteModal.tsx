import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Textarea'
import { FormError } from '@/components/ui/states'
import { errorMessage, isAppError } from '@/lib/errors'

export const NOTE_MAX = 500

interface NoteModalProps {
  title: string
  description?: string
  noteLabel: string
  confirmLabel: string
  destructive?: boolean
  /** Sem nota obrigatória a ação é uma confirmação simples. */
  required?: boolean
  onClose: () => void
  onConfirm: (note: string) => Promise<unknown>
  onDone: () => void
}

/** Ação com nota (≤500) — obrigatória em suspender/cancelar/rejeitar (BR-SEG-24, BR-SEG-20). */
export function NoteModal({
  title,
  description,
  noteLabel,
  confirmLabel,
  destructive = false,
  required = true,
  onClose,
  onConfirm,
  onDone,
}: NoteModalProps) {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function confirm() {
    const text = note.trim()
    if (required && !text) return setError('Indique o motivo.')
    if (text.length > NOTE_MAX) return setError(`O motivo tem no máximo ${NOTE_MAX} caracteres.`)
    setSaving(true)
    try {
      await onConfirm(text)
      onDone()
    } catch (err) {
      setError(
        isAppError(err, 'CONFLICT') ? 'O estado mudou entretanto. Atualize a lista e tente novamente.' : errorMessage(err),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={confirm} loading={saving}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Textarea
          label={noteLabel}
          value={note}
          maxLength={NOTE_MAX}
          onChange={(event) => {
            setNote(event.target.value)
            setError(null)
          }}
        />
        <FormError message={error} />
      </div>
    </Modal>
  )
}
