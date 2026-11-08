import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Receipt } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useClinicAuth } from '@/contexts/ClinicAuthContext'
import { paths } from '@/routes/paths'
import type { ReceiptBookingKind } from '@/types/clinicReceipt'
import { IssueReceiptModal } from './IssueReceiptModal'

interface ReceiptActionProps {
  bookingKind: ReceiptBookingKind
  bookingId: string
  /** Recibo `ISSUED` da marcação (vem na marcação; nunca para o Médico). */
  receiptId?: string
  patientName: string
  serviceName?: string
  /** Recarrega a lista depois de emitir. */
  onChanged?: () => void
}

/**
 * "Emitir recibo" / "Ver recibo" numa marcação **concluída** (UC-CLN-25). Escondido ao Médico
 * (BR-CLN-39): sem financeiro, e o servidor também recusa.
 */
export function ReceiptAction({ bookingKind, bookingId, receiptId, patientName, serviceName, onChanged }: ReceiptActionProps) {
  const { isDoctor } = useClinicAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [issuing, setIssuing] = useState(false)
  if (isDoctor) return null

  if (receiptId) {
    return (
      <Button
        size="sm"
        variant="ghost"
        icon={<FileText className="size-4" aria-hidden />}
        onClick={() => navigate(paths.clinicReceipt(receiptId))}
      >
        Ver recibo
      </Button>
    )
  }
  return (
    <>
      <Button size="sm" variant="soft" icon={<Receipt className="size-4" aria-hidden />} onClick={() => setIssuing(true)}>
        Emitir recibo
      </Button>
      {issuing && (
        <IssueReceiptModal
          bookingKind={bookingKind}
          bookingId={bookingId}
          patientName={patientName}
          serviceName={serviceName}
          onClose={() => setIssuing(false)}
          onIssued={(receipt) => {
            setIssuing(false)
            toast.show('Recibo emitido.')
            onChanged?.()
            navigate(paths.clinicReceipt(receipt.id))
          }}
        />
      )}
    </>
  )
}
