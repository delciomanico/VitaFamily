import { ClipboardList } from 'lucide-react'
import { ButtonLink } from '@/components/ui/Button'
import { useClinicAuth } from '@/contexts/ClinicAuthContext'
import { paths } from '@/routes/paths'
import type { ClinicBooking } from '@/types/clinic'

/**
 * Entrada para o relatório da consulta (M15 S, clinic-portal-v2 §5.1): o Médico abre o editor
 * (com o estado no rótulo); Admin e Gestor só veem a ligação quando já existe relatório, em leitura.
 * O servidor continua a negar escritas a Admin/Gestor (BR-CLN-44).
 */
export function ReportAction({ booking }: { booking: Pick<ClinicBooking, 'id' | 'reportStatus'> }) {
  const { isDoctor } = useClinicAuth()
  if (!isDoctor && !booking.reportStatus) return null
  const state = booking.reportStatus === 'FINAL' ? ' (final)' : booking.reportStatus === 'DRAFT' ? ' (rascunho)' : ''
  return (
    <ButtonLink
      to={paths.clinicConsultationReport(booking.id)}
      variant="ghost"
      size="sm"
      icon={<ClipboardList className="size-4" aria-hidden />}
    >
      {isDoctor ? `Relatório${state}` : 'Ver relatório'}
    </ButtonLink>
  )
}
