import { ReportPdfButton } from '@/components/clinic/reports/ReportPdfButton'
import { examResultsDraftService } from '@/services/clinicReport.service'

/** "Laudo (PDF)": descarrega só o laudo gerado pelo sistema (BR-CLN-48/49). */
export function ExamReportButton({ examinationId }: { examinationId: string }) {
  return (
    <ReportPdfButton
      label="Laudo (PDF)"
      variant="soft"
      load={() => examResultsDraftService.reportPdf(examinationId)}
    />
  )
}
