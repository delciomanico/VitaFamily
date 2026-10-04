import { Link } from 'react-router-dom'
import { ChevronRight, FileText } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { formatCount, formatShortDate } from '@/lib/format'
import { prescriptionStatus } from '@/lib/labels'
import { paths } from '@/routes/paths'
import type { PrescriptionSummary } from '@/types/prescription'

interface PrescriptionListProps {
  items: PrescriptionSummary[]
  /** Membro do próprio utilizador: o nome só aparece nas receitas de outros. */
  selfMemberId?: string
}

/** Receitas numa só lista: médico, clínica, data, número de medicamentos e estado. */
export function PrescriptionList({ items, selfMemberId }: PrescriptionListProps) {
  return (
    <Card className="divide-y divide-border py-1">
      {items.map(({ prescription, memberName, medicationCount }) => {
        const status = prescriptionStatus[prescription.status]
        const details = [prescription.clinicName, prescription.memberId !== selfMemberId ? memberName : null]
        return (
          <Link
            key={prescription.id}
            to={paths.prescription(prescription.id)}
            className="-mx-2 flex items-center gap-3 rounded-md px-2 py-3 transition-colors hover:bg-surface-muted"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
              <FileText className="size-5" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium">{prescription.doctorName ?? 'Receita'}</span>
                <Badge tone={status.tone} dot className="ml-auto">
                  {status.label}
                </Badge>
              </span>
              <span className="truncate text-sm text-muted">
                {details.filter(Boolean).join(' · ') || 'Sem clínica indicada'}
              </span>
              <span className="text-sm text-muted">
                {formatShortDate(prescription.issuedOn)} · {formatCount(medicationCount, 'medicamento', 'medicamentos')}
              </span>
            </span>
            <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
          </Link>
        )
      })}
    </Card>
  )
}
