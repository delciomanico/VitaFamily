import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Banknote, Download } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { bookingStatusText, isStateChange, disputeDecisionHint, disputeDecisionLabel, paymentStatusText, proofTypeLabel, queueStatusLabel } from '@/lib/consultations'
import { saveBlob } from '@/lib/download'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatWhenLuanda } from '@/lib/format'
import { formatFileSize, formatKz, offerMethodLabel } from '@/lib/professional'
import { paths } from '@/routes/paths'
import { adminConsultationService } from '@/services/adminConsultation.service'
import type { AdminPaymentDisputeDetail, PaymentDisputeDecision } from '@/types/consultations'

const DECISIONS: PaymentDisputeDecision[] = ['CONFIRM_PAYMENT', 'UPHOLD_REJECTION']

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="text-sm text-muted sm:w-44 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  )
}

/** Detalhe de uma disputa (`/admin/payment-disputes/:proofId`, UC-MKT-38, BR-MKT-58/63): só a marcação e o comprovativo; acesso auditado. */
export function AdminPaymentDisputeDetailPage() {
  const { proofId = '' } = useParams()
  const toast = useToast()
  const { state, reload } = useAsync(() => adminConsultationService.getDispute(proofId), [proofId])
  const [updated, setUpdated] = useState<{ id: string; detail: AdminPaymentDisputeDetail } | null>(null)
  const [decision, setDecision] = useState<PaymentDisputeDecision | null>(null)
  const [deciding, setDeciding] = useState(false)
  const detail = updated?.id === proofId ? updated.detail : state.status === 'success' ? state.data : null

  function refresh() {
    setUpdated(null)
    reload()
  }

  async function decide(value: PaymentDisputeDecision) {
    setDeciding(true)
    try {
      setUpdated({ id: proofId, detail: await adminConsultationService.decideDispute(proofId, value) })
      setDecision(null)
      toast.show('Decisão registada.')
    } catch (error) {
      setDecision(null)
      if (isStateChange(error) || isAppError(error, 'NOT_FOUND')) {
        // Já decidida ou a marcação foi cancelada entretanto: mostra o estado atual.
        toast.show('Esta disputa já não está por decidir.', 'error')
        refresh()
      } else toast.show(errorMessage(error), 'error')
    } finally {
      setDeciding(false)
    }
  }

  async function download() {
    try {
      saveBlob(await adminConsultationService.downloadProof(proofId), `comprovativo.${proofTypeLabel[detail?.proof.contentType ?? 'application/pdf'].toLowerCase()}`)
    } catch (error) {
      toast.show(isAppError(error, 'DOCUMENT_NOT_AVAILABLE') ? 'O ficheiro já não está disponível para descarregar.' : errorMessage(error), 'error')
    }
  }

  const back = (
    <Link to={paths.adminPaymentDisputes} className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-primary">
      <ArrowLeft className="size-4" aria-hidden />
      Voltar às disputas
    </Link>
  )

  if (!detail) {
    return (
      <>
        {back}
        {state.status === 'error' ? (
          isAppError(state.error, 'NOT_FOUND') ? (
            <EmptyState icon={Banknote} title="Disputa não encontrada." description="Pode ter sido retirada da fila (marcação cancelada)." />
          ) : (
            <ErrorState message={errorMessage(state.error)} onRetry={refresh} />
          )
        ) : (
          <LoadingState rows={3} />
        )}
      </>
    )
  }

  const { booking, proof } = detail
  const open = detail.status === 'DISPUTED'
  return (
    <>
      {back}
      <h1 className="text-xl font-semibold">Disputa de pagamento</h1>

      <Card className="flex flex-col gap-3">
        <Badge tone={queueStatusLabel[detail.status].tone} dot className="self-start">
          {queueStatusLabel[detail.status].label}
        </Badge>
        <h2 className="font-semibold">Marcação</h2>
        <dl className="flex flex-col gap-2">
          <InfoRow label="Profissional">
            {booking.professional.displayName}
            {booking.professional.city ? ` · ${booking.professional.city}` : ''}
          </InfoRow>
          <InfoRow label="Especialidade">{booking.specialtyName}</InfoRow>
          <InfoRow label="Método">
            {offerMethodLabel[booking.method]} · {booking.durationMinutes} min
          </InfoRow>
          <InfoRow label="Hora">{formatWhenLuanda(booking.startsAt)}</InfoRow>
          <InfoRow label="Preço">{formatKz(booking.priceKz)}</InfoRow>
          <InfoRow label="Estado da marcação">{bookingStatusText[booking.status].label}</InfoRow>
          <InfoRow label="Estado do pagamento">{paymentStatusText[booking.paymentStatus].label}</InfoRow>
          {detail.professionalReason && <InfoRow label="Motivo do profissional">{detail.professionalReason}</InfoRow>}
          {detail.familyNote && <InfoRow label="Nota da família">{detail.familyNote}</InfoRow>}
          <InfoRow label="Disputa aberta em">{formatWhenLuanda(detail.disputedAt)}</InfoRow>
          {detail.decision && <InfoRow label="Decisão">{disputeDecisionLabel[detail.decision]}</InfoRow>}
          {detail.decidedAt && detail.decision && <InfoRow label="Decidida em">{formatWhenLuanda(detail.decidedAt)}</InfoRow>}
        </dl>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-semibold">Comprovativo</h2>
        <p className="text-sm text-muted">
          {proofTypeLabel[proof.contentType]} · {formatFileSize(proof.sizeBytes)} · enviado {formatWhenLuanda(proof.submittedAt)}
        </p>
        {open && proof.scanStatus === 'CLEAN' && (
          <Button variant="secondary" className="w-fit" icon={<Download className="size-4" aria-hidden />} onClick={() => void download()}>
            Descarregar comprovativo
          </Button>
        )}
        {!open && <p className="text-sm text-muted">Depois da decisão o ficheiro já não se descarrega.</p>}
      </Card>

      <Card className="bg-warning-soft text-sm text-foreground">Só vê a marcação e o comprovativo. Cada abertura e cada descarregamento ficam registados. Não valida dinheiro: decide apenas se a recusa se mantém.</Card>

      {open && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted">Decisão</h2>
          <Card className="flex flex-col gap-4">
            {DECISIONS.map((value) => (
              <div key={value} className="flex flex-col gap-1">
                <Button variant={value === 'CONFIRM_PAYMENT' ? 'primary' : 'secondary'} size="sm" className="self-start" disabled={deciding} onClick={() => setDecision(value)}>
                  {disputeDecisionLabel[value]}
                </Button>
                <p className="text-sm text-muted">{disputeDecisionHint[value]}</p>
              </div>
            ))}
          </Card>
        </section>
      )}

      {decision && (
        <ConfirmDialog
          open
          title={`${disputeDecisionLabel[decision]}?`}
          description={disputeDecisionHint[decision]}
          confirmLabel={disputeDecisionLabel[decision]}
          loading={deciding}
          onConfirm={() => void decide(decision)}
          onCancel={() => setDecision(null)}
        />
      )}
    </>
  )
}
