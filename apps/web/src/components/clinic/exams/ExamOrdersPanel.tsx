import { useState } from 'react'
import { FlaskConical, Plus } from 'lucide-react'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DetailSection } from '@/components/ui/InfoList'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useClinicAuth } from '@/contexts/ClinicAuthContext'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage } from '@/lib/errors'
import { clinicExamOrderService } from '@/services/clinicExamOrder.service'
import {
  EXAM_ORDER_MAX_ACTIVE,
  EXAM_ORDER_STATUS_LABEL,
  type ClinicExamOrder,
  type ExamOrderStatus,
} from '@/types/examOrder'
import { ExamOrderDialog } from './ExamOrderDialog'
import { ExamOrderPdfButton } from './ExamOrderPdfButton'

const tones: Record<ExamOrderStatus, Tone> = { ORDERED: 'primary', SCHEDULED: 'warning', FULFILLED: 'success', CANCELLED: 'neutral' }

interface ExamOrdersPanelProps {
  bookingId: string
  /** Marcação onde ainda se pode pedir exames (SCHEDULED ou COMPLETED). */
  open: boolean
  /** Avisa quando a lista muda (para atualizar o contador de fora). */
  onChanged?: () => void
}

/**
 * Pedidos de exame de uma marcação (M15 U, clinic-portal-v2 §5.5): o Médico pede e cancela;
 * Admin e Gestor só leem e imprimem. O servidor decide; aqui só se esconde o que não se pode.
 */
export function ExamOrdersPanel({ bookingId, open, onChanged }: ExamOrdersPanelProps) {
  const toast = useToast()
  const { isDoctor } = useClinicAuth()
  const { state, reload } = useAsync(() => clinicExamOrderService.list(bookingId), [bookingId])
  const [ordering, setOrdering] = useState(false)
  const [cancelling, setCancelling] = useState<ClinicExamOrder | null>(null)
  const [busy, setBusy] = useState(false)

  const changed = () => {
    reload()
    onChanged?.()
  }

  async function cancel() {
    if (!cancelling) return
    setBusy(true)
    try {
      await clinicExamOrderService.cancel(bookingId, cancelling.id)
      toast.show('Pedido cancelado.')
      setCancelling(null)
      changed()
    } catch (error) {
      toast.show(errorMessage(error), 'error')
      setCancelling(null)
    } finally {
      setBusy(false)
    }
  }

  const orders = state.status === 'success' ? state.data : []
  const active = orders.filter((o) => o.status !== 'CANCELLED')
  const atLimit = active.length >= EXAM_ORDER_MAX_ACTIVE

  return (
    <DetailSection
      title="Pedidos de exame"
      action={
        <div className="flex flex-wrap gap-2">
          {active.length > 0 && <ExamOrderPdfButton bookingId={bookingId} />}
          {isDoctor && open && (
            <Button size="sm" disabled={atLimit} onClick={() => setOrdering(true)} icon={<Plus className="size-4" aria-hidden />}>
              Pedir exames
            </Button>
          )}
        </div>
      }
    >
      {state.status === 'loading' && <LoadingState rows={2} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' &&
        (orders.length === 0 ? (
          <p className="text-sm text-muted">Sem pedidos de exame nesta consulta.</p>
        ) : (
          <Card className="divide-y divide-border py-1">
            {orders.map((order) => (
              <div key={order.id} className="flex flex-wrap items-center gap-3 py-3">
                <FlaskConical className="size-5 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{order.name}</p>
                  {order.note && <p className="text-sm text-muted">{order.note}</p>}
                </div>
                {order.urgent && <Badge tone="danger">Urgente</Badge>}
                <Badge tone={tones[order.status]} dot>
                  {EXAM_ORDER_STATUS_LABEL[order.status]}
                </Badge>
                {isDoctor && (order.status === 'ORDERED' || order.status === 'SCHEDULED') && (
                  <Button variant="danger-ghost" size="sm" onClick={() => setCancelling(order)}>
                    Cancelar pedido
                  </Button>
                )}
              </div>
            ))}
          </Card>
        ))}
      {atLimit && isDoctor && open && <p className="text-sm text-muted">Atingiu o máximo de {EXAM_ORDER_MAX_ACTIVE} pedidos ativos.</p>}
      {ordering && (
        <ExamOrderDialog
          bookingId={bookingId}
          alreadyActive={active.length}
          onClose={() => setOrdering(false)}
          onCreated={() => {
            setOrdering(false)
            toast.show('Pedido de exame criado.')
            changed()
          }}
        />
      )}
      <ConfirmDialog
        open={cancelling !== null}
        title="Cancelar este pedido?"
        description="O pedido não se edita: depois de cancelado, se necessário, crie outro."
        confirmLabel="Cancelar pedido"
        cancelLabel="Voltar"
        destructive
        loading={busy}
        onConfirm={() => void cancel()}
        onCancel={() => setCancelling(null)}
      />
    </DetailSection>
  )
}
