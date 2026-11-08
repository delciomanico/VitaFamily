import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, FileText } from 'lucide-react'
import { ExamReportButton } from '@/components/clinic/exams/ExamReportButton'
import {
  emptyRow,
  ExamResultsDraftForm,
  rowsFromDraft,
  rowToInput,
  validateRows,
  type ResultRow,
} from '@/components/clinic/exams/ExamResultsDraftForm'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Switch } from '@/components/ui/Switch'
import { Textarea } from '@/components/ui/Textarea'
import { ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { AppError, errorMessage, isAppError } from '@/lib/errors'
import { formatLongDate, formatTime } from '@/lib/format'
import { paths } from '@/routes/paths'
import { clinicPortalService } from '@/services/clinicPortal.service'
import { examResultsDraftService } from '@/services/clinicReport.service'
import type { ClinicExamBooking } from '@/types/clinic'
import type { ClinicExamResultsDraft } from '@/types/clinicReport'
import { DOCUMENT_MAX_BYTES } from '@/types/document'

interface WorkspaceProps {
  exam: ClinicExamBooking
  draft: ClinicExamResultsDraft | null
  onDone: () => void
}

/** Tabela de parâmetros, rascunho, "gerar laudo" e conclusão do exame (BR-CLN-08/47/48). */
function ResultsWorkspace({ exam, draft, onDone }: WorkspaceProps) {
  const toast = useToast()
  const [rows, setRows] = useState<ResultRow[]>(() => (draft ? rowsFromDraft(draft.results) : [emptyRow()]))
  const [note, setNote] = useState(draft?.resultNote ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [generateReport, setGenerateReport] = useState(true)
  const [hasDraft, setHasDraft] = useState(draft !== null)
  const [savedAt, setSavedAt] = useState<string | null>(draft ? formatTime(draft.updatedAt) : null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'draft' | 'complete' | 'discard' | null>(null)
  const [discarding, setDiscarding] = useState(false)

  async function saveDraft() {
    const { filled, error: invalid } = validateRows(rows)
    if (invalid) return setError(invalid)
    if (filled.length === 0 && !note.trim()) return setError('Indique pelo menos um parâmetro ou uma nota.')
    setBusy('draft')
    try {
      const saved = await examResultsDraftService.saveDraft(exam.id, {
        results: filled.map(rowToInput),
        resultNote: note,
      })
      setHasDraft(true)
      setSavedAt(formatTime(saved.updatedAt))
      setError(null)
      toast.show('Rascunho guardado.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function discard() {
    setBusy('discard')
    try {
      await examResultsDraftService.discardDraft(exam.id)
      setRows([emptyRow()])
      setNote('')
      setHasDraft(false)
      setSavedAt(null)
      setDiscarding(false)
      toast.show('Rascunho descartado.')
    } catch (err) {
      setError(errorMessage(err))
      setDiscarding(false)
    } finally {
      setBusy(null)
    }
  }

  async function complete() {
    const { filled, error: invalid } = validateRows(rows)
    if (invalid) return setError(invalid)
    if (filled.length === 0 && !file && exam.documents.length === 0) {
      return setError('Indique pelo menos um parâmetro ou anexe o PDF dos resultados.')
    }
    if (file && (file.type !== 'application/pdf' || file.size > DOCUMENT_MAX_BYTES)) {
      return setError('O ficheiro tem de ser um PDF até 10 MB.')
    }
    setBusy('complete')
    try {
      if (file) {
        await clinicPortalService.uploadExamDocument(exam.id, {
          originalName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          file,
        })
      }
      // `results` explícito (mesmo vazio): o pedido manda sobre o rascunho (BR-CLN-47).
      await clinicPortalService.completeExam(exam.id, {
        results: filled.map(rowToInput),
        resultNote: note,
        generateReport,
      })
      toast.show('Resultados emitidos.')
      onDone()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(null)
    }
  }

  const structured = rows.some((r) => r.parameter.trim() && r.value.trim())

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <p className="text-sm text-muted">Os valores ficam visíveis para o paciente, sem interpretação.</p>
      <ExamResultsDraftForm rows={rows} onChange={(next) => { setRows(next); setError(null) }} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="exam-pdf" className="text-sm font-medium">
          PDF dos resultados (opcional)
        </label>
        <input
          id="exam-pdf"
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
        {exam.documents.map((doc) => (
          <p key={doc.id} className="flex items-center gap-1.5 text-sm text-muted">
            <FileText className="size-4" aria-hidden /> {doc.originalName}
          </p>
        ))}
      </div>

      <Textarea label="Nota (opcional)" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />

      <Switch
        label="Gerar laudo em PDF"
        description={
          structured
            ? 'O laudo fica disponível para o paciente e para si.'
            : 'O laudo só é gerado com pelo menos um parâmetro.'
        }
        checked={generateReport}
        onChange={setGenerateReport}
      />

      {/* Única referência ao realce: o editor nunca assinala valores (BR-CLN-48). */}
      <p className="text-sm text-muted">
        O laudo indica «Fora da referência» por comparação aritmética; não é interpretação clínica.
      </p>

      <FormError message={error} />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" loading={busy === 'draft'} onClick={() => void saveDraft()}>
          Guardar rascunho
        </Button>
        {hasDraft && (
          <Button variant="danger-ghost" onClick={() => setDiscarding(true)}>
            Descartar rascunho
          </Button>
        )}
        <Button loading={busy === 'complete'} onClick={() => void complete()}>
          Concluir exame
        </Button>
        <p role="status" className="text-sm text-muted">
          {savedAt ? `Rascunho guardado às ${savedAt}` : 'Sem rascunho'}
        </p>
      </div>

      <ConfirmDialog
        open={discarding}
        title="Descartar o rascunho?"
        description="Os parâmetros guardados são apagados. O exame continua por concluir."
        confirmLabel="Descartar"
        destructive
        loading={busy === 'discard'}
        onConfirm={() => void discard()}
        onCancel={() => setDiscarding(false)}
      />
    </div>
  )
}

/** `/clinic/exams/:examinationId/results` — rascunho, conclusão e laudo (M15 T, ADR-027). */
export function ExamResultsPage() {
  const { examinationId = '' } = useParams()
  const { state, reload } = useAsync(async () => {
    const exam = (await clinicPortalService.listExamAgenda()).find((e) => e.id === examinationId)
    if (!exam) throw new AppError('NOT_FOUND')
    const draft = exam.status === 'SCHEDULED' ? await examResultsDraftService.getDraft(examinationId) : null
    return { exam, draft }
  }, [examinationId])

  return (
    <>
      <Link to={paths.clinicExams} className="flex w-fit items-center gap-1.5 text-sm font-medium text-primary">
        <ArrowLeft className="size-4" aria-hidden />
        Exames
      </Link>
      <h1 className="text-xl font-semibold">Resultados do exame</h1>
      {state.status === 'loading' && <LoadingState rows={4} />}
      {state.status === 'error' &&
        (isAppError(state.error, 'NOT_FOUND') ? (
          <ErrorState message="Este exame não existe na sua clínica." />
        ) : (
          <ErrorState onRetry={reload} />
        ))}
      {state.status === 'success' && (
        <>
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">{state.data.exam.patientName}</h2>
            <p className="text-sm text-muted">
              {state.data.exam.examType ?? 'Exame'} · {formatLongDate(state.data.exam.scheduledAt)} ·{' '}
              {formatTime(state.data.exam.scheduledAt)}
            </p>
          </div>
          {state.data.exam.status === 'SCHEDULED' ? (
            <ResultsWorkspace exam={state.data.exam} draft={state.data.draft} onDone={reload} />
          ) : state.data.exam.status === 'COMPLETED' ? (
            <Card className="flex max-w-3xl flex-col gap-3">
              <p className="text-sm">
                Resultados emitidos: {state.data.exam.resultsCount} parâmetros · {state.data.exam.documents.length} PDF.
              </p>
              {state.data.exam.reportAvailable ? (
                <div className="flex flex-wrap items-center gap-2">
                  <ExamReportButton examinationId={state.data.exam.id} />
                  <Badge tone="primary">Gerado pelo sistema</Badge>
                </div>
              ) : (
                <p className="text-sm text-muted">Sem laudo gerado para este exame.</p>
              )}
            </Card>
          ) : (
            <p className="text-sm text-muted">Este exame foi cancelado.</p>
          )}
        </>
      )}
    </>
  )
}
