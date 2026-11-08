import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Textarea'
import { errorMessage } from '@/lib/errors'
import { ADDENDUM_MAX_LENGTH } from '@/types/clinicReport'

interface AddendumDialogProps {
  onClose: () => void
  /** Grava a adenda; rejeita com `AppError` em caso de falha. */
  onSave: (text: string) => Promise<void>
}

/** Acrescentar uma adenda datada a um relatório FINAL (UC-CLN-34). `Esc` fecha. */
export function AddendumDialog({ onClose, onSave }: AddendumDialogProps) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!text.trim()) return setError('Escreva o texto da adenda.')
    setSaving(true)
    try {
      await onSave(text)
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Acrescentar adenda"
      description="A adenda fica datada e assinada, e não pode ser alterada nem apagada."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Voltar
          </Button>
          <Button loading={saving} onClick={() => void save()}>
            Guardar adenda
          </Button>
        </>
      }
    >
      <Textarea
        label="Texto da adenda"
        rows={5}
        maxLength={ADDENDUM_MAX_LENGTH}
        value={text}
        hint={`${text.length}/${ADDENDUM_MAX_LENGTH} caracteres`}
        error={error}
        onChange={(event) => {
          setText(event.target.value)
          setError(undefined)
        }}
      />
    </Modal>
  )
}
