import { AttendanceStatementButton, canIssueStatement } from './AttendanceStatementButton'
import { ExamOrdersAction } from './exams/ExamOrdersAction'
import { ReportAction } from './reports/ReportAction'
import type { ClinicBooking } from '@/types/clinic'

type DocBooking = Pick<
  ClinicBooking,
  'id' | 'patientName' | 'status' | 'scheduledAt' | 'dayState' | 'arrivedAt' | 'reportStatus' | 'examOrderCount'
>

/**
 * Relatório, pedidos de exame e declaração de uma marcação, para a ficha do paciente e o calendário
 * (clinic-portal-v2 §5.5): reutiliza as mesmas ações do Hoje/Agenda, sem rotas novas. Só aparecem
 * para consultas em curso ou concluídas (ou com algo já registado).
 */
export function BookingDocumentActions({ booking, onChanged }: { booking: DocBooking; onChanged?: () => void }) {
  const inCare = canIssueStatement(booking) || (booking.status === 'SCHEDULED' && Date.parse(booking.scheduledAt) <= Date.now())
  const hasRecords = Boolean(booking.reportStatus) || (booking.examOrderCount ?? 0) > 0
  if (!inCare && !hasRecords) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(inCare || booking.reportStatus) && <ReportAction booking={booking} />}
      <ExamOrdersAction booking={booking} onChanged={onChanged} />
      <AttendanceStatementButton booking={booking} />
    </div>
  )
}
