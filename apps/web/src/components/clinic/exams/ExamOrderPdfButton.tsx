import { ReportPdfButton } from '@/components/clinic/reports/ReportPdfButton'
import { clinicExamOrderService } from '@/services/clinicExamOrder.service'

/** Abre o PDF "Pedido de exame" num separador novo (gerado a pedido; não se guarda, BR-CLN-54). */
export function ExamOrderPdfButton({ bookingId, variant = 'secondary' }: { bookingId: string; variant?: 'secondary' | 'soft' | 'ghost' }) {
  return <ReportPdfButton load={() => clinicExamOrderService.pdf(bookingId)} label="Imprimir pedido" variant={variant} />
}
