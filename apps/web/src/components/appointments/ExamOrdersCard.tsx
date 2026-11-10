import { FlaskConical } from 'lucide-react'
import { Badge, type Tone } from '@/components/ui/Badge'
import { ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DetailSection } from '@/components/ui/InfoList'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { paths } from '@/routes/paths'
import { familyExamOrderService } from '@/services/familyExamOrder.service'
import { EXAM_ORDER_STATUS_LABEL, type ExamOrderStatus } from '@/types/examOrder'

const tones: Record<ExamOrderStatus, Tone> = { ORDERED: 'primary', SCHEDULED: 'warning', FULFILLED: 'success', CANCELLED: 'neutral' }

/**
 * Cartão "Exames pedidos" no detalhe da consulta (M15 U, BR-CLN-52/53): só se renderiza quando
 * `examOrderCount > 0` (0 para quem não pode ler). "Marcar este exame" abre o formulário de
 * marcação existente com o nome pré-preenchido e liga o exame ao pedido.
 */
export function ExamOrdersCard({ appointmentId, memberId }: { appointmentId: string; memberId: string }) {
  const { user, family } = useAuth()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(
    () => familyExamOrderService.list(familyId, userId, memberId, { appointmentId }),
    [familyId, userId, memberId, appointmentId],
  )

  return (
    <DetailSection title="Exames pedidos">
      {state.status === 'loading' && <LoadingState rows={2} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && (
        <Card className="divide-y divide-border py-1">
          {state.data.map((order) => (
            <div key={order.id} className="flex flex-col gap-2 py-3">
              <div className="flex items-start gap-3">
                <FlaskConical className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{order.name}</p>
                  {order.note && <p className="text-sm text-muted">{order.note}</p>}
                  <p className="text-sm text-muted">Pedido por {order.clinicName}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {order.urgent && <Badge tone="danger">Urgente</Badge>}
                  <Badge tone={tones[order.status]} dot>
                    {EXAM_ORDER_STATUS_LABEL[order.status]}
                  </Badge>
                </div>
              </div>
              {order.status === 'ORDERED' && (
                <ButtonLink to={paths.examinationFromOrder(order, memberId)} variant="soft" size="sm" className="self-start">
                  Marcar este exame
                </ButtonLink>
              )}
              {order.examinationId && order.status !== 'ORDERED' && (
                <ButtonLink to={paths.examination(order.examinationId)} variant="ghost" size="sm" className="self-start">
                  Ver o exame
                </ButtonLink>
              )}
            </div>
          ))}
        </Card>
      )}
    </DetailSection>
  )
}
