import { FileText } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { RowLink } from '@/components/ui/RowLink'
import { formatCount, formatShortDate } from '@/lib/format'
import { prescriptionStatus } from '@/lib/labels'
import { paths } from '@/routes/paths'
import type { PrescriptionSummary } from '@/types/prescription'

interface PrescriptionListProps {
  items: PrescriptionSummary[]
  /** Membro do próprio utilizador: o nome só aparece nas receitas de outros. */
  selfMemberId?: string
  /** Falso = só leitura (perfil de um membro que partilha, sem acesso ao detalhe). */
  linked?: boolean
}

/** Receitas numa só lista: médico, clínica, data, número de medicamentos e estado. */
export function PrescriptionList({ items, selfMemberId, linked = true }: PrescriptionListProps) {
  return (
    <Card className="divide-y divide-border py-1">
      {items.map(({ prescription, memberName, medicationCount }) => {
        const status = prescriptionStatus[prescription.status]
        const details = [prescription.clinicName, prescription.memberId !== selfMemberId ? memberName : null]
        return (
          <RowLink key={prescription.id} to={paths.prescription(prescription.id)} linked={linked}>
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
          </RowLink>
        )
      })}
    </Card>
  )
}
