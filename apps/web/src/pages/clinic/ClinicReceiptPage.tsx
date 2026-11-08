import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Ban, Smartphone } from 'lucide-react'
import { PrintReceiptButton, ReceiptDocument } from '@/components/domain/ReceiptDocument'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Textarea'
import { ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatLongDate } from '@/lib/format'
import { receiptNumber } from '@/lib/receipt'
import { paths } from '@/routes/paths'
import { clinicReceiptService } from '@/services/clinicReceipt.service'
import {
  RECEIPT_VOID_REASON_MAX,
  RECEIPT_VOID_REASON_MIN,
  type ClinicReceipt,
} from '@/types/clinicReceipt'

/** Anular com motivo (UC-CLN-26, BR-CLN-33): irreversível; o motivo fica só na clínica. */
function VoidModal({
  receipt,
  onClose,
  onVoided,
}: {
  receipt: ClinicReceipt
  onClose: () => void
  onVoided: (receipt: ClinicReceipt) => void
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function confirm() {
    const text = reason.trim()
    if (text.length < RECEIPT_VOID_REASON_MIN) return setError('Indique o motivo (pelo menos 3 letras).')
    if (text.length > RECEIPT_VOID_REASON_MAX) return setError(`O motivo tem no máximo ${RECEIPT_VOID_REASON_MAX} caracteres.`)
    setSaving(true)
    try {
      onVoided(await clinicReceiptService.void(receipt.id, text))
    } catch (err) {
      setError(isAppError(err, 'CONFLICT') ? 'Este recibo já foi anulado.' : errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Anular o recibo ${receiptNumber(receipt.number)}?`}
      description="O número fica guardado e deixa de contar nos totais. Não se pode desfazer; para corrigir, emita um novo recibo."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button variant="danger" onClick={() => void confirm()} loading={saving}>
            Anular recibo
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Textarea
          label="Motivo da anulação"
          hint="Só a clínica o vê; não vai ao paciente."
          value={reason}
          onChange={(event) => {
            setReason(event.target.value)
            setError(null)
          }}
        />
        <FormError message={error} />
      </div>
    </Modal>
  )
}

/** Um recibo da clínica (UC-CLN-25/26/27): vista imprimível, "Imprimir / Guardar PDF" e Anular. */
export function ClinicReceiptPage() {
  const { receiptId = '' } = useParams()
  const toast = useToast()
  const { state, reload } = useAsync(() => clinicReceiptService.get(receiptId), [receiptId])
  const [voiding, setVoiding] = useState(false)

  return (
    <>
      <Link
        to={paths.clinicFinance}
        className="no-print flex w-fit items-center gap-1.5 text-sm font-medium text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Financeiro
      </Link>

      {state.status === 'loading' && <LoadingState rows={4} />}
      {state.status === 'error' &&
        (isAppError(state.error, 'NOT_FOUND') ? (
          <ErrorState message="Este recibo não existe na sua clínica." />
        ) : (
          <ErrorState onRetry={reload} />
        ))}
      {state.status === 'success' && (
        <div className="flex max-w-3xl flex-col gap-4">
          <div className="no-print flex flex-wrap items-center gap-2">
            <PrintReceiptButton />
            {state.data.status === 'ISSUED' && (
              <Button variant="danger-ghost" icon={<Ban className="size-4" aria-hidden />} onClick={() => setVoiding(true)}>
                Anular
              </Button>
            )}
            {state.data.availableToPatient && (
              <Badge tone="primary">
                <Smartphone className="mr-1 inline size-3.5" aria-hidden />
                Disponível na app do paciente
              </Badge>
            )}
          </div>

          <ReceiptDocument
            data={{
              number: state.data.number,
              issuedAt: state.data.issuedAt,
              issuerName: state.data.issuer.name,
              issuerAddress: state.data.issuer.address,
              issuerPhone: state.data.issuer.phone,
              issuerEmail: state.data.issuer.email,
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

          {state.data.status === 'VOIDED' && (
            <Card className="no-print flex flex-col gap-1">
              <p className="text-sm font-semibold">
                Anulado{state.data.voidedAt ? ` em ${formatLongDate(state.data.voidedAt)}` : ''}
              </p>
              {state.data.voidReason && <p className="text-sm">Motivo (interno): {state.data.voidReason}</p>}
              <p className="text-sm text-muted">Para corrigir, emita um novo recibo a partir da marcação.</p>
            </Card>
          )}
          {!state.data.availableToPatient && (
            <p className="no-print text-sm text-muted">
              Este recibo é só da clínica (visita presencial ou paciente sem consentimento na emissão): imprima e entregue
              em mãos.
            </p>
          )}
        </div>
      )}

      {voiding && state.status === 'success' && (
        <VoidModal
          receipt={state.data}
          onClose={() => setVoiding(false)}
          onVoided={() => {
            setVoiding(false)
            toast.show('Recibo anulado.')
            reload()
          }}
        />
      )}
    </>
  )
}
