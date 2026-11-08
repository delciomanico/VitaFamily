import { useState } from 'react'
import { Check, FileText, Inbox, Receipt, X } from 'lucide-react'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { Tabs } from '@/components/ui/Tabs'
import { Textarea } from '@/components/ui/Textarea'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatShortDate } from '@/lib/format'
import { formatMinor, receiptNumber } from '@/lib/receipt'
import { insurancePortalService } from '@/services/insurancePortal.service'
import type { ClaimDecision, ClaimStatus, InsuranceClaimView } from '@/types/insurance'

const statusInfo: Record<ClaimStatus, { label: string; tone: Tone }> = {
  SUBMITTED: { label: 'Por decidir', tone: 'warning' },
  APPROVED: { label: 'Aprovado', tone: 'success' },
  REJECTED: { label: 'Recusado', tone: 'danger' },
  PAID: { label: 'Pago', tone: 'primary' },
}

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat('pt-PT', { style: 'currency', currency }).format(amount)

const NOTE_MAX = 1000

/** `PUT /insurance-portal/claims/{id}/decide` (BR-INS-05): recusar exige motivo. */
function DecideForm({
  claim,
  decision,
  onClose,
  onDone,
}: {
  claim: InsuranceClaimView
  decision: ClaimDecision
  onClose: () => void
  onDone: () => void
}) {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const reject = decision === 'REJECT'

  async function confirm() {
    if (reject && !note.trim()) return setError('Indique o motivo da recusa.')
    if (note.trim().length > NOTE_MAX) return setError(`A nota tem no máximo ${NOTE_MAX} caracteres.`)
    setSaving(true)
    try {
      await insurancePortalService.decideClaim(claim.id, decision, note)
      onDone()
    } catch (err) {
      setError(isAppError(err, 'CONFLICT') ? 'Este pedido já foi decidido.' : errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={reject ? 'Recusar pedido?' : 'Aprovar pedido?'}
      description={`${money(claim.amount, claim.currency)} · apólice ${claim.policyNumber}. O titular é informado do resultado.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button variant={reject ? 'danger' : 'primary'} onClick={confirm} loading={saving}>
            {reject ? 'Recusar' : 'Aprovar'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Textarea
          label={reject ? 'Motivo da recusa' : 'Nota (opcional)'}
          value={note}
          onChange={(event) => {
            setNote(event.target.value)
            setError(null)
          }}
        />
        <FormError message={error} />
      </div>
    </Modal>
  )
}

type Filter = 'SUBMITTED' | 'ALL'

/**
 * Pedidos de reembolso (`/insurance-portal/claims`, BR-INS-04/05/07): a seguradora vê o mínimo —
 * titular da apólice, número, valor e a lista de documentos escolhidos — e decide. Nunca vê a
 * família nem o membro. O contrato não tem ainda rota para abrir os documentos (OP-16).
 */
export function InsuranceClaimsPage() {
  const toast = useToast()
  const [filter, setFilter] = useState<Filter>('SUBMITTED')
  const { state, reload } = useAsync(
    () => insurancePortalService.listClaims(filter === 'SUBMITTED' ? 'SUBMITTED' : undefined),
    [filter],
  )
  const [deciding, setDeciding] = useState<{ claim: InsuranceClaimView; decision: ClaimDecision } | null>(null)

  return (
    <>
      <h1 className="text-xl font-semibold">Pedidos de reembolso</h1>
      <Tabs
        label="Estado dos pedidos"
        value={filter}
        onChange={setFilter}
        items={[
          { value: 'SUBMITTED', label: 'Por decidir' },
          { value: 'ALL', label: 'Todos' },
        ]}
      />

      {state.status === 'loading' && <LoadingState rows={3} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' &&
        (state.data.length > 0 ? (
          <div className="flex flex-col gap-3">
            {state.data.map((claim) => (
              <Card key={claim.id} className="flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-lg font-semibold">{money(claim.amount, claim.currency)}</span>
                    <span className="block truncate text-sm text-muted">
                      {claim.policyHolderName} · apólice {claim.policyNumber}
                    </span>
                  </span>
                  <Badge tone={statusInfo[claim.status].tone} dot>
                    {statusInfo[claim.status].label}
                  </Badge>
                </div>
                <p className="flex items-center gap-1.5 text-sm text-muted">
                  <FileText className="size-4" aria-hidden />
                  {claim.documentIds.length === 1 ? '1 documento anexado' : `${claim.documentIds.length} documentos anexados`}
                </p>
                {/* Resumo mínimo dos recibos que o titular anexou (BR-CLN-36): sem PDF, ids, profissional nem método. */}
                {claim.receipts && claim.receipts.length > 0 && (
                  <ul className="flex flex-col gap-2" aria-label="Recibos anexados">
                    {claim.receipts.map((receipt) => (
                      <li key={`${receipt.clinicName}-${receipt.number}`} className="rounded-lg bg-surface-muted p-3 text-sm">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          <Receipt className="size-4" aria-hidden />
                          {receiptNumber(receipt.number)} · {receipt.clinicName}
                          {receipt.status === 'VOIDED' && <Badge tone="danger">Anulado</Badge>}
                        </p>
                        <p className="text-muted">
                          {formatShortDate(receipt.issuedAt)} · {formatMinor(receipt.totalMinor, receipt.currency)}
                        </p>
                        <ul className="mt-1">
                          {receipt.lines.map((line, index) => (
                            <li key={index} className="flex justify-between gap-3">
                              <span>{line.description}</span>
                              <span className="tabular-nums">{formatMinor(line.amountMinor, receipt.currency)}</span>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
                {claim.decisionNote && <p className="text-sm">Nota: {claim.decisionNote}</p>}
                {claim.status === 'SUBMITTED' && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => setDeciding({ claim, decision: 'APPROVE' })}
                      icon={<Check className="size-4" aria-hidden />}
                    >
                      Aprovar
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setDeciding({ claim, decision: 'REJECT' })}
                      icon={<X className="size-4" aria-hidden />}
                    >
                      Recusar
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Inbox}
            title={filter === 'SUBMITTED' ? 'Sem pedidos por decidir.' : 'Sem pedidos.'}
            description="Os pedidos dos titulares aparecem aqui assim que forem submetidos."
          />
        ))}

      {deciding && (
        <DecideForm
          claim={deciding.claim}
          decision={deciding.decision}
          onClose={() => setDeciding(null)}
          onDone={() => {
            toast.show(deciding.decision === 'APPROVE' ? 'Pedido aprovado.' : 'Pedido recusado.')
            setDeciding(null)
            reload()
          }}
        />
      )}
    </>
  )
}
