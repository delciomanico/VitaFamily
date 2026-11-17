import { Badge } from '@/components/ui/Badge'
import { validationStatusLabel, validationStatusTone } from '@/lib/professional'
import type { ProfessionalValidationStatus } from '@/types/professional'

/** Estado de validação em linguagem simples (UC-MKT-12), com ponto de cor. */
export function ValidationStatusBadge({ status }: { status: ProfessionalValidationStatus }) {
  return (
    <Badge tone={validationStatusTone[status]} dot>
      {validationStatusLabel[status]}
    </Badge>
  )
}
