import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ClipboardList, Plus } from 'lucide-react'
import { AddendumDialog } from '@/components/clinic/reports/AddendumDialog'
import {
  ConsultationReportEditor,
  emptyReportFields,
  hasReportText,
  toReportInput,
  type ReportDraftFields,
} from '@/components/clinic/reports/ConsultationReportEditor'
import { ExamOrdersPanel } from '@/components/clinic/exams/ExamOrdersPanel'
import { ReportAddendaList } from '@/components/clinic/reports/ReportAddendaList'
import { ReportPdfButton } from '@/components/clinic/reports/ReportPdfButton'
import { ReportSectionsView } from '@/components/clinic/reports/ReportSectionsView'
import { ReportStatusBadge } from '@/components/clinic/reports/ReportStatusBadge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DetailSection } from '@/components/ui/InfoList'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useClinicAuth } from '@/contexts/ClinicAuthContext'
import { useAsync } from '@/hooks/useAsync'
import { AppError, errorMessage, isAppError } from '@/lib/errors'
import { formatLongDate, formatTime } from '@/lib/format'
import { paths } from '@/routes/paths'
import { clinicPortalService } from '@/services/clinicPortal.service'
import { clinicReportService } from '@/services/clinicReport.service'
import type { ClinicBooking } from '@/types/clinic'
import type { ConsultationReport } from '@/types/clinicReport'

/** Autosave do rascunho 10 s depois da última alteração (clinic-portal-v2 §5.1). */
const AUTOSAVE_MS = 10_000

const fieldsOf = (report: ConsultationReport | null): ReportDraftFields =>
  report
    ? {
        reason: report.reason ?? '',
        findings: report.findings ?? '',
        impression: report.impression ?? '',
        plan: report.plan ?? '',
        sharedWithPatient: report.sharedWithPatient,
      }
    : emptyReportFields()

interface WorkspaceProps {
  booking: ClinicBooking
  initial: ConsultationReport | null
}

/** Editor (Médico, rascunho) ou vista só de leitura (FINAL, Admin, Gestor) do relatório de uma marcação. */
function ReportWorkspace({ booking, initial }: WorkspaceProps) {
  const toast = useToast()
  const { isDoctor } = useClinicAuth()
  const [report, setReport] = useState(initial)
  const [fields, setFields] = useState(() => fieldsOf(initial))
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(initial ? formatTime(initial.updatedAt) : null)
  const [saving, setSaving] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [addendum, setAddendum] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const version = useRef(0)

  const shareable = booking.source !== 'MANUAL'
  const open = booking.status === 'SCHEDULED' || booking.status === 'COMPLETED'
  const editable = isDoctor && open && report?.status !== 'FINAL'

  async function save(silent: boolean): Promise<ConsultationReport | null> {
    if (!hasReportText(fields)) {
      if (!silent) setError('Escreva pelo menos uma secção.')
      return null
    }
    const sent = version.current
    setSaving(true)
    try {
      const saved = await clinicReportService.save(booking.id, toReportInput(fields, shareable))
      setReport(saved)
      setSavedAt(formatTime(saved.updatedAt))
      if (version.current === sent) setDirty(false)
      setError(null)
      if (!silent) toast.show('Rascunho guardado.')
      return saved
    } catch (err) {
      setError(errorMessage(err))
      return null
    } finally {
      setSaving(false)
    }
  }

  // Autosave: sempre a versão mais recente do `save`, sem reiniciar o temporizador a cada render.
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  })
  useEffect(() => {
    if (!editable || !dirty || !hasReportText(fields)) return
    const timer = window.setTimeout(() => void saveRef.current(true), AUTOSAVE_MS)
    return () => window.clearTimeout(timer)
  }, [editable, dirty, fields])

  async function finalize() {
    setFinalizing(true)
    try {
      // Grava o que está no ecrã antes de finalizar.
      if ((dirty || !report) && !(await save(true))) {
        setConfirming(false)
        return
      }
      setReport(await clinicReportService.finalize(booking.id))
      setDirty(false)
      setConfirming(false)
      toast.show('Relatório finalizado.')
    } catch (err) {
      setError(errorMessage(err))
      setConfirming(false)
    } finally {
      setFinalizing(false)
    }
  }

  async function addAddendum(text: string) {
    setReport(await clinicReportService.addAddendum(booking.id, text))
    setAddendum(false)
    toast.show('Adenda guardada.')
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{booking.patientName}</h2>
          {report && <ReportStatusBadge status={report.status} />}
        </div>
        <p className="text-sm text-muted">
          {formatLongDate(booking.scheduledAt)} · {formatTime(booking.scheduledAt)}
          {booking.specialty ? ` · ${booking.specialty}` : ''}
        </p>
      </div>

      {!isDoctor && !report && (
        <EmptyState
          icon={ClipboardList}
          title="Esta consulta ainda não tem relatório."
          description="O relatório é escrito e finalizado pelo médico."
        />
      )}

      {editable && (
        <>
          <ConsultationReportEditor value={fields} specialty={booking.specialty} shareable={shareable} onChange={(next) => {
            version.current += 1
            setFields(next)
            setDirty(true)
          }} />
          <FormError message={error} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" loading={saving} onClick={() => void save(false)}>
              Guardar rascunho
            </Button>
            <Button onClick={() => (hasReportText(fields) ? setConfirming(true) : setError('Escreva pelo menos uma secção.'))}>
              Finalizar relatório
            </Button>
            {report?.status === 'DRAFT' && <ReportPdfButton load={() => clinicReportService.pdf(booking.id)} />}
            <p role="status" className="text-sm text-muted">
              {saving ? 'A guardar…' : savedAt ? `Guardado às ${savedAt}` : 'Ainda não guardado'}
            </p>
          </div>
        </>
      )}

      {!editable && report && (
        <>
          <Card className="flex flex-col gap-4">
            <ReportSectionsView report={report} />
            {report.status === 'FINAL' && (
              <p className="text-sm text-muted">
                {report.authorName}
                {report.finalizedAt ? ` · finalizado em ${formatLongDate(report.finalizedAt)} ${formatTime(report.finalizedAt)}` : ''}
                {report.bookingKind === 'APPOINTMENT'
                  ? report.sharedWithPatient
                    ? ' · partilhado com o paciente'
                    : ' · não partilhado com o paciente'
                  : ''}
              </p>
            )}
          </Card>
          <FormError message={error} />
          <div className="flex flex-wrap items-center gap-2">
            <ReportPdfButton load={() => clinicReportService.pdf(booking.id)} />
            {isDoctor && report.status === 'FINAL' && (
              <Button variant="soft" size="sm" onClick={() => setAddendum(true)} icon={<Plus className="size-4" aria-hidden />}>
                Acrescentar adenda
              </Button>
            )}
          </div>
          {report.status === 'FINAL' && (
            <DetailSection title="Adendas">
              {report.addenda.length > 0 ? (
                <ReportAddendaList addenda={report.addenda} />
              ) : (
                <p className="text-sm text-muted">Sem adendas.</p>
              )}
            </DetailSection>
          )}
          {isDoctor && report.status === 'DRAFT' && !open && (
            <p className="text-sm text-muted">Esta marcação já não permite editar o rascunho.</p>
          )}
        </>
      )}

      {/* M15 U: pedidos de exame da marcação (Médico pede/cancela; Admin e Gestor leem e imprimem). */}
      <ExamOrdersPanel bookingId={booking.id} open={open} />

      <ConfirmDialog
        open={confirming}
        title="Finalizar o relatório?"
        description="Depois de finalizar só pode acrescentar adendas."
        confirmLabel="Finalizar"
        loading={finalizing}
        onConfirm={() => void finalize()}
        onCancel={() => setConfirming(false)}
      />
      {addendum && <AddendumDialog onClose={() => setAddendum(false)} onSave={addAddendum} />}
    </div>
  )
}

/** `/clinic/consultations/:bookingId/report` — relatório da consulta (M15 S, ADR-027). */
export function ConsultationReportPage() {
  const { bookingId = '' } = useParams()
  const { state, reload } = useAsync(async () => {
    const booking = (await clinicPortalService.listAgenda()).find((b) => b.id === bookingId)
    if (!booking) throw new AppError('NOT_FOUND')
    return { booking, report: await clinicReportService.get(bookingId) }
  }, [bookingId])

  return (
    <>
      <Link to={paths.clinicAgenda} className="flex w-fit items-center gap-1.5 text-sm font-medium text-primary">
        <ArrowLeft className="size-4" aria-hidden />
        Agenda
      </Link>
      <h1 className="text-xl font-semibold">Relatório da consulta</h1>
      {state.status === 'loading' && <LoadingState rows={4} />}
      {state.status === 'error' &&
        (isAppError(state.error, 'NOT_FOUND') ? (
          <ErrorState message="Esta consulta não existe na sua agenda." />
        ) : (
          <ErrorState onRetry={reload} />
        ))}
      {state.status === 'success' && <ReportWorkspace booking={state.data.booking} initial={state.data.report} />}
    </>
  )
}
