import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { FormError } from '@/components/ui/states'
import { errorMessage } from '@/lib/errors'
import { clinicExamOrderService } from '@/services/clinicExamOrder.service'
import {
  emptyExamOrderRow,
  examOrderRowsError,
  ExamOrderLines,
  toExamOrderItems,
  type ExamOrderRow,
} from './ExamOrderLines'

interface ExamOrderDialogProps {
  bookingId: string
  /** Pedidos já ativos (limite de 5 por marcação, BR-CLN-51). */
  alreadyActive: number
  onClose: () => void
  onCreated: () => void
}

/** Pede 1–5 exames de uma marcação (`POST …/exam-orders`); imutáveis depois de criados. */
export function ExamOrderDialog({ bookingId, alreadyActive, onClose, onCreated }: ExamOrderDialogProps) {
  const [rows, setRows] = useState<ExamOrderRow[]>([emptyExamOrderRow()])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit() {
    const invalid = examOrderRowsError(rows, alreadyActive)
    if (invalid) return setError(invalid)
    setSaving(true)
    try {
      await clinicExamOrderService.create(bookingId, toExamOrderItems(rows))
      onCreated()
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
      title="Pedir exames"
      description="O paciente recebe um aviso e pode marcar o exame na app. Pode também imprimir o pedido."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            Pedir exames
          </Button>
        </>
      }
    >
      <div className="flex max-h-[60dvh] flex-col gap-4 overflow-y-auto pr-1">
        <ExamOrderLines
          rows={rows}
          alreadyActive={alreadyActive}
          onChange={(next) => {
            setRows(next)
            setError(null)
          }}
        />
        <FormError message={error} />
      </div>
    </Modal>
  )
}
