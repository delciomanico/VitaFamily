import { useParams } from 'react-router-dom'
import { ReportAddendaList } from '@/components/clinic/reports/ReportAddendaList'
import { ReportPdfButton } from '@/components/clinic/reports/ReportPdfButton'
import { ReportSectionsView } from '@/components/clinic/reports/ReportSectionsView'
import { Page } from '@/components/layout/Page'
import { Card } from '@/components/ui/Card'
import { DetailSection, InfoList, InfoRow } from '@/components/ui/InfoList'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { isAppError } from '@/lib/errors'
import { formatLongDate, formatTime } from '@/lib/format'
import { paths } from '@/routes/paths'
import { appointmentService } from '@/services/appointment.service'
import { familyReportService } from '@/services/familyReport.service'

/** Relatório da consulta, só leitura, com PDF (M15 S, BR-CLN-45): titular ou tutor, só FINAL partilhado. */
export function ConsultationReportPage() {
  const { id = '' } = useParams()
  const { user, family } = useAuth()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(async () => {
    const { appointment } = await appointmentService.getAppointment(familyId, userId, id)
    const report = await familyReportService.get(familyId, userId, appointment.memberId, id)
    return { memberId: appointment.memberId, report }
  }, [familyId, userId, id])

  return (
    <Page title="Relatório da consulta" backTo={paths.appointment(id)} backLabel="Consulta">
      {state.status === 'loading' && <LoadingState rows={4} />}
      {state.status === 'error' &&
        (isAppError(state.error, 'NOT_FOUND') || isAppError(state.error, 'FORBIDDEN') ? (
          <ErrorState message="Esta consulta não tem relatório disponível." />
        ) : (
          <ErrorState onRetry={reload} />
        ))}
      {state.status === 'success' && (
        <>
          <InfoList>
            <InfoRow label="Clínica" value={state.data.report.clinicName} />
            <InfoRow
              label="Data"
              value={`${formatLongDate(state.data.report.consultationAt)} · ${formatTime(state.data.report.consultationAt)}`}
            />
            {state.data.report.specialty && <InfoRow label="Especialidade" value={state.data.report.specialty} />}
            <InfoRow label="Profissional" value={state.data.report.authorName} />
          </InfoList>
          <Card>
            <ReportSectionsView report={state.data.report} />
          </Card>
          {state.data.report.addenda.length > 0 && (
            <DetailSection title="Adendas">
              <ReportAddendaList addenda={state.data.report.addenda} />
            </DetailSection>
          )}
          <p className="text-sm text-muted">{state.data.report.notice}</p>
          <div>
            <ReportPdfButton
              label="Descarregar PDF"
              load={() => familyReportService.pdf(familyId, userId, state.data.memberId, id)}
            />
          </div>
        </>
      )}
    </Page>
  )
}
