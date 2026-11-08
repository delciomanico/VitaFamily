import { Badge } from '@/components/ui/Badge'
import { confirmationLabel } from '@/lib/clinicDay'
import type { ClinicBooking, ConfirmationStatus } from '@/types/clinic'

interface ConfirmationBadgeProps {
  status: ClinicBooking['status']
  confirmationStatus?: ConfirmationStatus | null
  confirmationSource?: 'PATIENT' | 'CLINIC' | null
}

/**
 * Estado de confirmação (BR-CLN-25): só faz sentido numa marcação por realizar (SCHEDULED) ou
 * recusada pelo paciente ("Não posso"). Em exames (nulo) e nos desfechos não se mostra.
 */
export function ConfirmationBadge({ status, confirmationStatus, confirmationSource }: ConfirmationBadgeProps) {
  if (!confirmationStatus) return null
  if (status !== 'SCHEDULED' && confirmationStatus !== 'DECLINED') return null
  const { label, tone } = confirmationLabel(confirmationStatus, confirmationSource)
  return <Badge tone={tone}>{label}</Badge>
}
