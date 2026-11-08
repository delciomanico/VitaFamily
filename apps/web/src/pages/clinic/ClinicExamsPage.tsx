import { useState } from 'react'
import { FileText, FlaskConical } from 'lucide-react'
import { RecommendationModal } from '@/components/domain/RecommendationModal'
import { DaySelector } from '@/components/clinic/DaySelector'
import { ExamReportButton } from '@/components/clinic/exams/ExamReportButton'
import { ReceiptAction } from '@/components/clinic/ReceiptAction'
import { nextDays } from '@/components/domain/DatePickers'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DetailSection } from '@/components/ui/InfoList'
import { Modal } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Textarea'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useClinicAuth } from '@/contexts/ClinicAuthContext'
import { useAsync } from '@/hooks/useAsync'
import { localDay } from '@/lib/appointment'
import { todayISO } from '@/lib/date'
import { errorMessage } from '@/lib/errors'
import { formatRelativeDay, formatTime } from '@/lib/format'
import { paths } from '@/routes/paths'
import { clinicPortalService } from '@/services/clinicPortal.service'
import type { ClinicExamBooking } from '@/types/clinic'

const AGENDA_DAYS = 21

const statuses: Record<ClinicExamBooking['status'], { label: string; tone: Tone }> = {
  SCHEDULED: { label: 'Agendado', tone: 'primary' },
  COMPLETED: { label: 'Realizado', tone: 'success' },
  CANCELLED: { label: 'Cancelado', tone: 'neutral' },
}

/**
 * Agenda de exames da clínica (`GET /clinic-portal/exam-agenda`, ADR-023): o paciente agenda
 * diretamente num horário com vagas, por isso não há pedidos a confirmar. A clínica cancela um
 * exame futuro (com motivo) ou emite os resultados quando a hora passou (BR-CLN-08).
 */
export function ClinicExamsPage() {
  const toast = useToast()
  // O Médico vê e conclui os seus exames, mas não os cancela nem emite recibos (BR-CLN-39).
  const { isDoctor } = useClinicAuth()
  const { state, reload } = useAsync(() => clinicPortalService.listExamAgenda(), [])
  const [day, setDay] = useState<string | null>(todayISO())
  const [cancelling, setCancelling] = useState<ClinicExamBooking | null>(null)
  const [recommending, setRecommending] = useState<ClinicExamBooking | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)

  const exams = state.status === 'success' ? state.data : []
  const marked = new Set(exams.map((b) => localDay(b.scheduledAt)))
  const shown = exams.filter((b) => !day || localDay(b.scheduledAt) === day)

  async function cancel() {
    if (!cancelling) return
    if (!note.trim()) return setError('Indique o motivo; o paciente vai recebê-lo.')
    setSaving(true)
    try {
      await clinicPortalService.cancelExam(cancelling.id, note)
      toast.show('Exame cancelado.')
      setCancelling(null)
      setNote('')
      reload()
    } catch (err) {
      toast.show(errorMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Exames agendados</h1>
      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div className="lg:sticky lg:top-6">
      <DaySelector
        days={nextDays(AGENDA_DAYS)}
        value={day}
        onChange={setDay}
        marked={marked}
        label="Escolher dia"
        allowClear
      />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && (
        <DetailSection title={day ? formatRelativeDay(day) : 'Todos os exames'}>
          {shown.length > 0 ? (
            <Card className="divide-y divide-border py-1">
              {shown.map((exam) => {
                const status = statuses[exam.status]
                return (
                  <div key={exam.id} className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center lg:gap-6">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span className="w-14 shrink-0 rounded-md bg-primary-soft py-2 text-center text-sm font-semibold text-primary tabular-nums">
                        {formatTime(exam.scheduledAt)}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-medium">{exam.patientName}</span>
                          <Badge tone={status.tone} dot className="ml-auto">
                            {status.label}
                          </Badge>
                        </span>
                        <p className="truncate text-sm text-muted">{exam.examType}</p>
                        {exam.notes && <p className="text-sm">“{exam.notes}”</p>}
                        {exam.responseNote && <p className="text-sm text-muted">Nota: {exam.responseNote}</p>}
                        {exam.status === 'COMPLETED' && (
                          <p className="flex items-center gap-1.5 text-sm text-muted">
                            <FileText className="size-4" aria-hidden />
                            {exam.resultsCount} parâmetros · {exam.documents.length} PDF
                          </p>
                        )}
                      </div>
                    </div>
                    {(exam.status === 'SCHEDULED' || exam.status === 'COMPLETED') && (
                      <div className="flex shrink-0 gap-2 sm:justify-end">
                        <Button variant="ghost" size="sm" onClick={() => setRecommending(exam)}>
                          Recomendação
                        </Button>
                        {exam.status !== 'SCHEDULED' ? null : Date.parse(exam.scheduledAt) <= Date.now() ? (
                          <ButtonLink
                            to={paths.clinicExamResults(exam.id)}
                            size="sm"
                            className="flex-1 sm:flex-none"
                          >
                            {exam.hasResultsDraft ? 'Continuar resultados' : 'Emitir resultados'}
                          </ButtonLink>
                        ) : (
                          !isDoctor && (
                            <Button variant="danger-ghost" size="sm" onClick={() => setCancelling(exam)}>
                              Cancelar exame
                            </Button>
                          )
                        )}
                        {exam.status === 'COMPLETED' && exam.reportAvailable && (
                          <ExamReportButton examinationId={exam.id} />
                        )}
                        {exam.status === 'COMPLETED' && (
                          <ReceiptAction
                            bookingKind="EXAM"
                            bookingId={exam.id}
                            receiptId={exam.receiptId}
                            patientName={exam.patientName}
                            serviceName={exam.examType}
                            onChanged={reload}
                          />
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </Card>
          ) : (
            <EmptyState icon={FlaskConical} title="Sem exames neste dia." />
          )}
        </DetailSection>
      )}
        </div>
      </div>

      <Modal
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title="Cancelar exame?"
        description={cancelling ? `${cancelling.patientName} será informado com o motivo indicado.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelling(null)}>
              Voltar
            </Button>
            <Button variant="danger" loading={saving} onClick={() => void cancel()}>
              Cancelar exame
            </Button>
          </>
        }
      >
        <Textarea
          label="Motivo"
          value={note}
          error={error}
          onChange={(event) => {
            setNote(event.target.value)
            setError(undefined)
          }}
        />
      </Modal>

      {recommending && (
        <RecommendationModal
          origin={{ examinationId: recommending.id }}
          patientName={recommending.patientName}
          onClose={() => setRecommending(null)}
          onSent={() => {
            setRecommending(null)
            toast.show('Recomendação enviada.')
          }}
        />
      )}

    </>
  )
}
