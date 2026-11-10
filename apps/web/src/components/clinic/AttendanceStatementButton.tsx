import { useState } from 'react'
import { FileCheck2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { errorMessage, isAppError } from '@/lib/errors'
import { openPdfInNewTab } from '@/lib/pdf'
import { clinicExamOrderService } from '@/services/clinicExamOrder.service'
import type { ClinicBooking } from '@/types/clinic'

/** Elegível: concluída ou com chegada registada (estados derivados ARRIVED/IN_PROGRESS/COMPLETED, BR-CLN-55). */
export const canIssueStatement = (booking: Pick<ClinicBooking, 'status' | 'dayState' | 'arrivedAt'>) =>
  booking.status === 'COMPLETED' ||
  booking.dayState === 'COMPLETED' ||
  (booking.status === 'SCHEDULED' &&
    (Boolean(booking.arrivedAt) || booking.dayState === 'ARRIVED' || booking.dayState === 'IN_PROGRESS'))

/**
 * "Declaração" de presença (M15 V, BR-CLN-55): um clique abre o PDF num separador novo; a opção
 * "Incluir o profissional" vem desligada. Só aparece quando a marcação é elegível; o servidor valida.
 */
export function AttendanceStatementButton({
  booking,
}: {
  booking: Pick<ClinicBooking, 'id' | 'status' | 'dayState' | 'arrivedAt'>
}) {
  const toast = useToast()
  const [includeProfessional, setIncludeProfessional] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!canIssueStatement(booking)) return null

  async function issue() {
    setBusy(true)
    try {
      openPdfInNewTab(await clinicExamOrderService.statementPdf(booking.id, includeProfessional))
    } catch (error) {
      toast.show(
        isAppError(error, 'CONFLICT') ? 'A declaração só se emite depois da chegada do paciente.' : errorMessage(error),
        'error',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="sm" loading={busy} onClick={() => void issue()} icon={<FileCheck2 className="size-4" aria-hidden />}>
        Declaração
      </Button>
      <label className="flex items-center gap-1.5 text-xs text-muted">
        <input
          type="checkbox"
          checked={includeProfessional}
          onChange={(event) => setIncludeProfessional(event.target.checked)}
          className="size-4 accent-primary"
        />
        Incluir o profissional
      </label>
    </span>
  )
}
