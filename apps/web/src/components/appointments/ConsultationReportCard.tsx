import { ClipboardList } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { DetailSection } from '@/components/ui/InfoList'
import { RowLink } from '@/components/ui/RowLink'
import { paths } from '@/routes/paths'

/**
 * Cartão "Relatório da consulta" no detalhe da consulta (M15 S, BR-CLN-45). Só se renderiza quando
 * há relatório FINAL partilhado e o utilizador é titular ou tutor: sem estados "indisponível".
 */
export function ConsultationReportCard({ appointmentId }: { appointmentId: string }) {
  return (
    <DetailSection title="Relatório da consulta">
      <Card className="py-0">
        <RowLink to={paths.appointmentReport(appointmentId)}>
          <ClipboardList className="size-5 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Ver o relatório da clínica</span>
            <span className="block text-sm text-muted">Texto da consulta e PDF para descarregar</span>
          </span>
        </RowLink>
      </Card>
    </DetailSection>
  )
}
