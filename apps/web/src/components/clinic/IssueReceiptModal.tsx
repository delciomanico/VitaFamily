import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { FormError, LoadingState } from '@/components/ui/states'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatMinor, paymentMethodLabel } from '@/lib/receipt'
import { parsePriceInput, priceToInput } from '@/pages/clinic/services/format'
import { clinicCatalogService } from '@/services/clinicCatalog.service'
import { clinicReceiptService } from '@/services/clinicReceipt.service'
import type { ClinicServiceType } from '@/types/clinic'
import type { ClinicReceipt, ReceiptBookingKind, ReceiptPaymentMethod } from '@/types/clinicReceipt'
import {
  RECEIPT_DESCRIPTION_MAX,
  RECEIPT_MAX_LINES,
  RECEIPT_MAX_MINOR,
  RECEIPT_NOTE_MAX,
} from '@/types/clinicReceipt'

interface IssueReceiptModalProps {
  bookingKind: ReceiptBookingKind
  bookingId: string
  patientName: string
  /** Nome do serviço do horário (especialidade/tipo de exame): pré-preenche a linha do catálogo. */
  serviceName?: string
  onClose: () => void
  onIssued: (receipt: ClinicReceipt) => void
}

interface LineDraft {
  key: number
  /** Vazio = linha livre. */
  serviceTypeId: string
  description: string
  amount: string
}

const FREE = ''
const METHODS = Object.keys(paymentMethodLabel) as ReceiptPaymentMethod[]

/**
 * "Emitir recibo" (UC-CLN-25, BR-CLN-31): um toque a partir de uma marcação concluída. A linha do
 * serviço (nome e preço do catálogo) vem preenchida; o valor pode ajustar-se e juntam-se linhas
 * livres. O método de pagamento é informativo — nada é cobrado aqui.
 */
export function IssueReceiptModal({
  bookingKind,
  bookingId,
  patientName,
  serviceName,
  onClose,
  onIssued,
}: IssueReceiptModalProps) {
  const catalog = useAsync(() => clinicCatalogService.listServices({ active: true }), [])
  const [lines, setLines] = useState<LineDraft[] | null>(null)
  const [method, setMethod] = useState<ReceiptPaymentMethod>('CASH')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const services: ClinicServiceType[] =
    catalog.state.status === 'success'
      ? catalog.state.data.filter((s) => (bookingKind === 'EXAM' ? s.kind === 'EXAM' : s.kind === 'APPOINTMENT'))
      : []

  // A primeira linha nasce com o serviço da marcação (se o catálogo o conhece e tem preço).
  const drafts: LineDraft[] | null =
    lines ??
    (catalog.state.status === 'loading'
      ? null
      : [
          (() => {
            const match = serviceName ? services.find((s) => s.name === serviceName && s.priceMinor !== undefined) : undefined
            return match
              ? { key: 1, serviceTypeId: match.id, description: match.name, amount: priceToInput(match.priceMinor) }
              : { key: 1, serviceTypeId: FREE, description: serviceName ?? '', amount: '' }
          })(),
        ])

  function update(key: number, patch: Partial<LineDraft>) {
    setLines((drafts ?? []).map((l) => (l.key === key ? { ...l, ...patch } : l)))
    setError(null)
  }

  function chooseService(key: number, serviceTypeId: string) {
    const service = services.find((s) => s.id === serviceTypeId)
    update(key, {
      serviceTypeId,
      description: service?.name ?? '',
      amount: service ? priceToInput(service.priceMinor) : '',
    })
  }

  const parsed = (drafts ?? []).map((l) => parsePriceInput(l.amount))
  const total = parsed.reduce<number>((sum, value) => sum + (typeof value === 'number' ? value : 0), 0)

  async function issue() {
    if (!drafts) return
    const lineInputs = []
    for (const [index, line] of drafts.entries()) {
      const amount = parsed[index]
      if (amount === null || amount === undefined || amount > RECEIPT_MAX_MINOR) {
        return setError('Indique um valor válido em todas as linhas, com até 2 casas decimais.')
      }
      if (line.serviceTypeId) lineInputs.push({ serviceTypeId: line.serviceTypeId, amountMinor: amount })
      else if (!line.description.trim()) return setError('Escreva a descrição de cada linha.')
      else lineInputs.push({ description: line.description.trim(), amountMinor: amount })
    }
    if (total < 1) return setError('O total do recibo tem de ser superior a zero.')
    if (total > RECEIPT_MAX_MINOR) return setError('O total é demasiado elevado.')
    setSaving(true)
    try {
      onIssued(
        await clinicReceiptService.issue({
          bookingKind,
          bookingId,
          paymentMethod: method,
          lines: lineInputs,
          note: note.trim() || undefined,
        }),
      )
    } catch (err) {
      setError(
        isAppError(err, 'CONFLICT')
          ? 'Esta marcação já tem um recibo emitido, ou ainda não está concluída.'
          : errorMessage(err),
      )
    } finally {
      setSaving(false)
    }
  }

  const currency = catalog.state.status === 'success' ? (catalog.state.data[0]?.currency ?? 'AOA') : 'AOA'

  return (
    <Modal
      open
      onClose={onClose}
      title="Emitir recibo"
      description={`${patientName}. Documento não fiscal, para entregar ao paciente.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Agora não
          </Button>
          <Button onClick={() => void issue()} loading={saving} disabled={!drafts}>
            Emitir
          </Button>
        </>
      }
    >
      {!drafts && <LoadingState rows={2} />}
      {drafts && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            {drafts.map((line, index) => (
              <div key={line.key} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <Select
                      label={`Serviço da linha ${index + 1}`}
                      value={line.serviceTypeId}
                      options={[
                        ...services
                          .filter((s) => s.priceMinor !== undefined)
                          .map((s) => ({ value: s.id, label: s.name })),
                        { value: FREE, label: 'Outro serviço (escrever)' },
                      ]}
                      onChange={(event) => chooseService(line.key, event.target.value)}
                    />
                  </div>
                  {drafts.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Remover a linha ${index + 1}`}
                      onClick={() => {
                        setLines(drafts.filter((l) => l.key !== line.key))
                        setError(null)
                      }}
                      className="mb-1 flex size-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-muted"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  )}
                </div>
                {!line.serviceTypeId && (
                  <Input
                    label={`Descrição da linha ${index + 1}`}
                    maxLength={RECEIPT_DESCRIPTION_MAX}
                    value={line.description}
                    onChange={(event) => update(line.key, { description: event.target.value })}
                  />
                )}
                <Input
                  label={`Valor da linha ${index + 1} (${currency})`}
                  inputMode="decimal"
                  value={line.amount}
                  onChange={(event) => update(line.key, { amount: event.target.value })}
                />
              </div>
            ))}
            {drafts.length < RECEIPT_MAX_LINES && (
              <Button
                variant="ghost"
                size="sm"
                className="w-fit"
                icon={<Plus className="size-4" aria-hidden />}
                onClick={() => {
                  const next = Math.max(...drafts.map((l) => l.key)) + 1
                  setLines([...drafts, { key: next, serviceTypeId: FREE, description: '', amount: '' }])
                }}
              >
                Adicionar linha
              </Button>
            )}
          </div>

          <p className="flex items-baseline justify-between text-base font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatMinor(total, currency)}</span>
          </p>

          <Select
            label="Método de pagamento"
            value={method}
            options={METHODS.map((m) => ({ value: m, label: paymentMethodLabel[m] }))}
            onChange={(event) => setMethod(event.target.value as ReceiptPaymentMethod)}
          />
          <Input
            label="Nota (opcional)"
            maxLength={RECEIPT_NOTE_MAX}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <FormError message={error} />
        </div>
      )}
    </Modal>
  )
}
