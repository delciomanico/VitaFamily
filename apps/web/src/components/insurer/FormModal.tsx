import { useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { FormError } from '@/components/ui/states'
import { errorMessage, isAppError, type ErrorCode } from '@/lib/errors'

interface FormModalProps {
  title: string
  description?: string
  submitLabel: string
  onClose: () => void
  /** Devolve uma mensagem de validação (string) para não submeter, ou submete e devolve `undefined`. */
  onSubmit: () => Promise<string | undefined> | string | undefined
  onDone: () => void
  /** Mensagens específicas por código de erro do servidor (ex.: CONFLICT → «Já existe…»). */
  errorMessages?: Partial<Record<ErrorCode, string>>
  children: ReactNode
}

/** Modal com formulário: valida no cliente, mostra o erro do servidor em português e fecha ao concluir. */
export function FormModal({ title, description, submitLabel, onClose, onSubmit, onDone, errorMessages = {}, children }: FormModalProps) {
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const problem = await onSubmit()
      if (problem) return setError(problem)
      onDone()
    } catch (err) {
      const custom = isAppError(err, 'CONFLICT') ? errorMessages.CONFLICT : undefined
      const byCode = err instanceof Error && 'code' in err ? errorMessages[(err as { code: ErrorCode }).code] : undefined
      setError(custom ?? byCode ?? errorMessage(err))
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
          <Button onClick={() => void submit()} loading={saving}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        {children}
        <FormError message={error} />
      </form>
    </Modal>
  )
}
