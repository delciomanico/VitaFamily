import { Badge } from '@/components/ui/Badge'

/** Estado do relatório da consulta: Rascunho | Final (BR-CLN-42). */
export function ReportStatusBadge({ status }: { status: 'DRAFT' | 'FINAL' }) {
  return status === 'FINAL' ? (
    <Badge tone="success" dot>
      Final
    </Badge>
  ) : (
    <Badge tone="warning" dot>
      Rascunho
    </Badge>
  )
}
