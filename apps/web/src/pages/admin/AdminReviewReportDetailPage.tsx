import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Star } from 'lucide-react'
import { Stars } from '@/components/consultations/Stars'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { formatMonth, isStateChange, queueStatusLabel, reviewDecisionHint, reviewDecisionLabel, reviewReportReasonLabel } from '@/lib/consultations'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatWhenLuanda } from '@/lib/format'
import { offerMethodLabel } from '@/lib/professional'
import { paths } from '@/routes/paths'
import { adminConsultationService } from '@/services/adminConsultation.service'
import type { AdminReviewReportDetail, ReviewReportDecision } from '@/types/consultations'

const DECISIONS: ReviewReportDecision[] = ['DISMISS', 'HIDE_COMMENT']

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="text-sm text-muted sm:w-44 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  )
}

/** Detalhe de uma denúncia de avaliação (`/admin/review-reports/:reportId`, UC-MKT-43, BR-MKT-60/63): só a avaliação; leitura auditada. */
export function AdminReviewReportDetailPage() {
  const { reportId = '' } = useParams()
  const toast = useToast()
  const { state, reload } = useAsync(() => adminConsultationService.getReviewReport(reportId), [reportId])
  const [updated, setUpdated] = useState<{ id: string; detail: AdminReviewReportDetail } | null>(null)
  const [decision, setDecision] = useState<ReviewReportDecision | null>(null)
  const [deciding, setDeciding] = useState(false)
  const detail = updated?.id === reportId ? updated.detail : state.status === 'success' ? state.data : null

  function refresh() {
    setUpdated(null)
    reload()
  }

  async function decide(value: ReviewReportDecision) {
    setDeciding(true)
    try {
      setUpdated({ id: reportId, detail: await adminConsultationService.decideReviewReport(reportId, value) })
      setDecision(null)
      toast.show('Decisão registada.')
    } catch (error) {
      setDecision(null)
      if (isStateChange(error)) {
        toast.show('Esta denúncia já foi decidida.', 'error')
        refresh()
      } else toast.show(errorMessage(error), 'error')
    } finally {
      setDeciding(false)
    }
  }

  const back = (
    <Link to={paths.adminReviewReports} className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-primary">
      <ArrowLeft className="size-4" aria-hidden />
      Voltar às denúncias
    </Link>
  )

  if (!detail) {
    return (
      <>
        {back}
        {state.status === 'error' ? (
          isAppError(state.error, 'NOT_FOUND') ? (
            <EmptyState icon={Star} title="Denúncia não encontrada." />
          ) : (
            <ErrorState message={errorMessage(state.error)} onRetry={refresh} />
          )
        ) : (
          <LoadingState rows={3} />
        )}
      </>
    )
  }

  const { review } = detail
  return (
    <>
      {back}
      <h1 className="text-xl font-semibold">Denúncia de avaliação</h1>

      <Card className="flex flex-col gap-3">
        <Badge tone={queueStatusLabel[detail.status].tone} dot className="self-start">
          {queueStatusLabel[detail.status].label}
        </Badge>
        <dl className="flex flex-col gap-2">
          <InfoRow label="Motivo">{reviewReportReasonLabel[detail.reason]}</InfoRow>
          {detail.note && <InfoRow label="Nota do profissional">{detail.note}</InfoRow>}
          <InfoRow label="Profissional">
            {detail.professional.displayName}
            {detail.professional.city ? ` · ${detail.professional.city}` : ''}
          </InfoRow>
          <InfoRow label="Denunciada em">{formatWhenLuanda(detail.createdAt)}</InfoRow>
          {detail.decision && <InfoRow label="Decisão">{reviewDecisionLabel[detail.decision]}</InfoRow>}
          {detail.decidedAt && <InfoRow label="Decidida em">{formatWhenLuanda(detail.decidedAt)}</InfoRow>}
        </dl>
      </Card>

      <Card className="bg-warning-soft text-sm text-foreground">Só vê a avaliação denunciada. Este acesso fica registado. Ocultar o comentário não altera a nota nem o ranking.</Card>

      <Card className="flex flex-col gap-2">
        <h2 className="font-semibold">Avaliação</h2>
        <Stars rating={review.rating} />
        {review.comment ? <p className="text-sm whitespace-pre-wrap">{review.comment}</p> : <p className="text-sm text-muted">Sem comentário.</p>}
        {review.commentHidden && <Badge tone="warning" className="self-start">Comentário já ocultado</Badge>}
        <p className="text-xs text-muted">
          {review.specialtyName} · {offerMethodLabel[review.method]} · consulta em {formatMonth(review.consultedMonth)}
        </p>
        {review.reply && (
          <div className="rounded-md bg-surface-muted px-3 py-2 text-sm">
            <p className="font-medium">Resposta do profissional</p>
            <p className="whitespace-pre-line">{review.reply.text}</p>
          </div>
        )}
      </Card>

      {detail.status === 'OPEN' && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted">Decisão</h2>
          <Card className="flex flex-col gap-4">
            {DECISIONS.map((value) => (
              <div key={value} className="flex flex-col gap-1">
                <Button variant={value === 'HIDE_COMMENT' ? 'primary' : 'secondary'} size="sm" className="self-start" disabled={deciding} onClick={() => setDecision(value)}>
                  {reviewDecisionLabel[value]}
                </Button>
                <p className="text-sm text-muted">{reviewDecisionHint[value]}</p>
              </div>
            ))}
          </Card>
        </section>
      )}

      {decision && (
        <ConfirmDialog
          open
          title={decision === 'DISMISS' ? 'Arquivar esta denúncia?' : 'Ocultar o comentário?'}
          description={reviewDecisionHint[decision]}
          confirmLabel={reviewDecisionLabel[decision]}
          loading={deciding}
          onConfirm={() => void decide(decision)}
          onCancel={() => setDecision(null)}
        />
      )}
    </>
  )
}
