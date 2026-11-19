import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Flag } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatWhenLuanda } from '@/lib/format'
import {
  decisionHint,
  decisionLabel,
  reportReasonLabel,
  reportStatusLabel,
  reportStatusTone,
  sideLabel,
} from '@/lib/marketplace'
import { paths } from '@/routes/paths'
import { adminMessageReportService } from '@/services/adminMessageReport.service'
import type { AdminMessageReportDetail, MessageReportDecision } from '@/types/marketplace'

const DECISIONS: MessageReportDecision[] = ['DISMISS', 'HIDE_MESSAGE', 'HIDE_AND_CLOSE']

const DECISION_VARIANT: Record<MessageReportDecision, 'primary' | 'secondary' | 'danger'> = {
  DISMISS: 'secondary',
  HIDE_MESSAGE: 'primary',
  HIDE_AND_CLOSE: 'danger',
}

const DECISION_TITLE: Record<MessageReportDecision, string> = {
  DISMISS: 'Arquivar esta denúncia?',
  HIDE_MESSAGE: 'Ocultar a mensagem denunciada?',
  HIDE_AND_CLOSE: 'Ocultar a mensagem e fechar a conversa?',
}

const DECISION_DONE = 'Decisão registada.'

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="text-sm text-muted sm:w-40 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  )
}

/** Detalhe de uma denúncia de mensagem (`/admin/message-reports/:reportId`, UC-MKT-24, BR-MKT-44). */
export function AdminMessageReportDetailPage() {
  const { reportId = '' } = useParams()
  const toast = useToast()
  const { state, reload } = useAsync(() => adminMessageReportService.get(reportId), [reportId])

  // Detalhe devolvido por uma decisão; descartado ao recarregar.
  const [updated, setUpdated] = useState<{ id: string; detail: AdminMessageReportDetail } | null>(null)
  const [decision, setDecision] = useState<MessageReportDecision | null>(null)
  const [deciding, setDeciding] = useState(false)

  const detail = updated?.id === reportId ? updated.detail : state.status === 'success' ? state.data : null

  function refresh() {
    setUpdated(null)
    reload()
  }

  async function decide(value: MessageReportDecision) {
    setDeciding(true)
    try {
      const next = await adminMessageReportService.decide(reportId, value)
      setUpdated({ id: reportId, detail: next })
      setDecision(null)
      toast.show(DECISION_DONE)
    } catch (error) {
      setDecision(null)
      if (isAppError(error, 'INVALID_STATE_TRANSITION')) {
        // Outro administrador decidiu entretanto: mostra o estado atual.
        toast.show('Esta denúncia já foi decidida.', 'error')
        refresh()
      } else {
        toast.show(errorMessage(error), 'error')
      }
    } finally {
      setDeciding(false)
    }
  }

  const backLink = (
    <Link to={paths.adminMessageReports} className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-primary">
      <ArrowLeft className="size-4" aria-hidden />
      Voltar às denúncias
    </Link>
  )

  if (!detail) {
    return (
      <>
        {backLink}
        {state.status === 'error' ? (
          isAppError(state.error, 'NOT_FOUND') ? (
            <EmptyState icon={Flag} title="Denúncia não encontrada." />
          ) : (
            <ErrorState message={errorMessage(state.error)} onRetry={refresh} />
          )
        ) : (
          <LoadingState rows={3} />
        )}
      </>
    )
  }

  const contextBefore = [...detail.contextBefore].sort((a, b) => a.seq - b.seq)

  return (
    <>
      {backLink}
      <h1 className="text-xl font-semibold">Denúncia de mensagem</h1>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={reportStatusTone[detail.status]} dot>
            {reportStatusLabel[detail.status]}
          </Badge>
        </div>
        <dl className="flex flex-col gap-2">
          <InfoRow label="Motivo">{reportReasonLabel[detail.reason]}</InfoRow>
          {detail.note && <InfoRow label="Nota do denunciante">{detail.note}</InfoRow>}
          <InfoRow label="Lado denunciado">{sideLabel[detail.reportedSide]}</InfoRow>
          <InfoRow label="Profissional">
            {detail.professional.displayName || 'Sem nome'}
            {detail.professional.city ? ` · ${detail.professional.city}` : ''}
          </InfoRow>
          <InfoRow label="Registada em">{formatWhenLuanda(detail.createdAt)}</InfoRow>
          {detail.status === 'DECIDED' && detail.decision && <InfoRow label="Decisão">{decisionLabel[detail.decision]}</InfoRow>}
          {detail.status === 'DECIDED' && detail.decidedAt && (
            <InfoRow label="Decidida em">{formatWhenLuanda(detail.decidedAt)}</InfoRow>
          )}
        </dl>
      </Card>

      {detail.reportedUserId && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted">Utilizador denunciado</h2>
          <Card className="flex flex-col gap-2">
            <p className="break-all font-mono text-sm">{detail.reportedUserId}</p>
            <p className="text-sm text-muted">
              Para suspender a conta use{' '}
              <Link to={paths.admin} className="font-medium text-primary">
                Administração &gt; Contas
              </Link>{' '}
              (sem automatismo).
            </p>
          </Card>
        </section>
      )}

      <Card className="bg-warning-soft text-sm text-foreground">
        Só vê a mensagem denunciada e até 2 anteriores. Este acesso fica registado.
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-muted">Contexto</h2>
        <Card className="flex flex-col gap-4">
          {contextBefore.length === 0 && <p className="text-sm text-muted">Sem mensagens anteriores.</p>}
          {contextBefore.length > 0 && (
            <ol className="flex flex-col gap-3">
              {contextBefore.map((message) => (
                <li key={message.id} className="flex flex-col gap-0.5 border-b border-border pb-3 last:border-b-0 last:pb-0">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{sideLabel[message.side]}</span>
                    <span className="text-sm text-muted">{formatWhenLuanda(message.createdAt)}</span>
                  </span>
                  {message.hidden ? (
                    <p className="text-sm italic text-muted">Mensagem ocultada.</p>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{message.text}</p>
                  )}
                </li>
              ))}
            </ol>
          )}

          <div className="flex flex-col gap-2 rounded-md border-2 border-warning p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">Mensagem denunciada</span>
              <span className="flex flex-wrap items-center gap-2">
                {detail.message.hidden && <Badge tone="warning">Ocultada para os participantes</Badge>}
                <span className="text-sm text-muted">{formatWhenLuanda(detail.message.createdAt)}</span>
              </span>
            </div>
            <p className="text-sm whitespace-pre-wrap">{detail.message.text}</p>
          </div>
        </Card>
      </section>

      {detail.status === 'OPEN' && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted">Decisão</h2>
          <Card className="flex flex-col gap-4">
            {DECISIONS.map((value) => (
              <div key={value} className="flex flex-col gap-1">
                <Button variant={DECISION_VARIANT[value]} size="sm" className="self-start" disabled={deciding} onClick={() => setDecision(value)}>
                  {decisionLabel[value]}
                </Button>
                <p className="text-sm text-muted">{decisionHint[value]}</p>
              </div>
            ))}
          </Card>
        </section>
      )}

      {decision && (
        <ConfirmDialog
          open
          title={DECISION_TITLE[decision]}
          description={decisionHint[decision]}
          confirmLabel={decisionLabel[decision]}
          destructive={decision === 'HIDE_AND_CLOSE'}
          loading={deciding}
          onConfirm={() => void decide(decision)}
          onCancel={() => setDecision(null)}
        />
      )}
    </>
  )
}
