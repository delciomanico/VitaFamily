import { useParams } from 'react-router-dom'
import { Page } from '@/components/layout/Page'
import { PrintReceiptButton, ReceiptDocument } from '@/components/domain/ReceiptDocument'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { isAppError } from '@/lib/errors'
import { paths } from '@/routes/paths'
import { familyReceiptService } from '@/services/clinicReceipt.service'

/**
 * Recibo recebido de uma clínica, como comprovativo (UC-CLN-28, BR-CLN-35): vista imprimível com
 * "Imprimir / Guardar PDF" (impressão do navegador). Só titular/tutor; sem o motivo da anulação.
 */
export function MemberReceiptPage() {
  const { id: memberId = '', receiptId = '' } = useParams()
  const { user, family } = useAuth()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(
    () => familyReceiptService.get(familyId, userId, memberId, receiptId),
    [familyId, userId, memberId, receiptId],
  )

  return (
    <Page title="Recibo da clínica" backTo={paths.familyMemberInsurance(memberId)} backLabel="Seguro e reembolsos">
      {state.status === 'loading' && <LoadingState rows={4} />}
      {state.status === 'error' &&
        (isAppError(state.error, 'NOT_FOUND') || isAppError(state.error, 'FORBIDDEN') ? (
          <ErrorState message="Não encontrámos este recibo." />
        ) : (
          <ErrorState onRetry={reload} />
        ))}
      {state.status === 'success' && (
        <div className="flex flex-col gap-4">
          <div className="no-print">
            <PrintReceiptButton />
          </div>
          <ReceiptDocument
            data={{
              number: state.data.number,
              issuedAt: state.data.issuedAt,
              issuerName: state.data.clinicName,
              issuerAddress: state.data.clinicAddress,
              issuerPhone: state.data.clinicPhone,
              patientName: state.data.patientName,
              lines: state.data.lines,
              totalMinor: state.data.totalMinor,
              currency: state.data.currency,
              paymentMethod: state.data.paymentMethod,
              status: state.data.status,
              voidedAt: state.data.voidedAt,
              note: state.data.note,
              notice: state.data.notice,
            }}
          />
          <p className="no-print text-sm text-muted">
            Comprovativo para o seu seguro: pode anexá-lo a um pedido de reembolso em “Seguro e reembolsos”.
          </p>
        </div>
      )}
    </Page>
  )
}
