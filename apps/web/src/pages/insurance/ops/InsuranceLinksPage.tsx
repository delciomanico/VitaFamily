import { useState } from 'react'
import { Link2 } from 'lucide-react'
import { NoteModal } from '@/components/insurer/NoteModal'
import { PageHeader } from '@/components/insurer/PageHeader'
import { PagedView } from '@/components/insurer/PagedView'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Tabs } from '@/components/ui/Tabs'
import { EmptyState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { usePagedList } from '@/hooks/usePagedList'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatShortDate } from '@/lib/format'
import { withFallback } from '@/lib/safe'
import { insurerOpsService } from '@/services/insurerOps.service'
import { linkStatusLabel, type InsurerLinkRequest, type LinkRequestStatus } from '@/types/insurerOps'

const tone = withFallback<LinkRequestStatus, Tone>(
  { PENDING: 'warning', CONFIRMED: 'success', REJECTED: 'danger', REVOKED: 'neutral' },
  () => 'neutral',
)
const label = withFallback(linkStatusLabel, (key) => key)

const TABS: Array<{ value: LinkRequestStatus; label: string }> = [
  { value: 'PENDING', label: 'Por decidir' },
  { value: 'CONFIRMED', label: 'Confirmadas' },
  { value: 'REJECTED', label: 'Rejeitadas' },
  { value: 'REVOKED', label: 'Revogadas' },
]

/**
 * Pedidos de ligação cartão ↔ paciente (BR-SEG-20): a seguradora confirma ou rejeita (com motivo).
 * Só vê o beneficiário e a data — nunca dados do utilizador ou da família do paciente.
 */
export function InsuranceLinksPage() {
  const toast = useToast()
  const [status, setStatus] = useState<LinkRequestStatus>('PENDING')
  const list = usePagedList((cursor) => insurerOpsService.listLinkRequests({ status, cursor }), [status])
  const [rejecting, setRejecting] = useState<InsurerLinkRequest | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function confirm(request: InsurerLinkRequest) {
    setBusy(request.id)
    try {
      await insurerOpsService.confirmLinkRequest(request.id)
      toast.show(`Ligação de ${request.beneficiaryName} confirmada.`)
    } catch (error) {
      toast.show(isAppError(error, 'CONFLICT') ? 'Este pedido já foi decidido.' : errorMessage(error), 'error')
    } finally {
      setBusy(null)
      list.reload()
    }
  }

  return (
    <>
      <PageHeader
        title="Ligações de cartão"
        description="Quando um paciente reclama um cartão no app, a seguradora confirma ou rejeita. Só depois o paciente vê o cartão e a cobertura."
      />
      <Tabs label="Estado da ligação" items={TABS} value={status} onChange={setStatus} scrollable />
      <PagedView
        list={list}
        empty={<EmptyState icon={Link2} title="Sem pedidos neste estado." description={status === 'PENDING' ? 'Não há ligações por decidir.' : undefined} />}
      >
        {(items) => (
          <Card className="divide-y divide-border py-1">
            {items.map((r) => (
              <div key={r.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.beneficiaryName}</span>
                  <Badge tone={tone[r.status]} dot>
                    {label[r.status]}
                  </Badge>
                </div>
                <p className="text-sm text-muted">
                  Cartão {r.cardNumber} · pedido em {formatShortDate(r.requestedAt)}
                  {r.decidedAt ? ` · decidido em ${formatShortDate(r.decidedAt)}` : ''}
                </p>
                {r.decisionNote && <p className="text-sm text-muted">Motivo: {r.decisionNote}</p>}
                {r.status === 'PENDING' && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" loading={busy === r.id} onClick={() => void confirm(r)}>
                      Confirmar <span className="sr-only">ligação de {r.beneficiaryName}</span>
                    </Button>
                    <Button size="sm" variant="danger-ghost" onClick={() => setRejecting(r)}>
                      Rejeitar <span className="sr-only">ligação de {r.beneficiaryName}</span>
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </Card>
        )}
      </PagedView>
      {rejecting && (
        <NoteModal
          title="Rejeitar ligação?"
          description={`O pedido de ${rejecting.beneficiaryName} é recusado e o paciente não vê o cartão.`}
          noteLabel="Motivo (obrigatório)"
          confirmLabel="Rejeitar ligação"
          destructive
          onClose={() => setRejecting(null)}
          onConfirm={(note) => insurerOpsService.rejectLinkRequest(rejecting.id, note)}
          onDone={() => {
            toast.show('Ligação rejeitada.')
            setRejecting(null)
            list.reload()
          }}
        />
      )}
    </>
  )
}
