import { Printer } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatLongDate, formatTime } from '@/lib/format'
import { formatMinor, paymentMethodLabel, receiptNumber } from '@/lib/receipt'
import type { ReceiptPaymentMethod, ReceiptStatus } from '@/types/clinicReceipt'
import { RECEIPT_NOTICE } from '@/types/clinicReceipt'

export interface ReceiptDocumentData {
  number: number
  issuedAt: string
  issuerName: string
  issuerAddress?: string | null
  issuerPhone?: string | null
  issuerEmail?: string | null
  patientName: string
  lines: Array<{ description: string; amountMinor: number }>
  totalMinor: number
  currency: string
  paymentMethod: ReceiptPaymentMethod
  status: ReceiptStatus
  voidedAt?: string | null
  note?: string | null
  notice?: string
}

/**
 * Recibo interno **não fiscal** (BR-CLN-31..37), em HTML imprimível: serve o portal (Financeiro) e
 * a app (comprovativo do titular). A zona `.print-area` é a única impressa (ver `styles/index.css`).
 */
export function ReceiptDocument({ data }: { data: ReceiptDocumentData }) {
  const voided = data.status === 'VOIDED'
  return (
    <article
      aria-label={`Recibo ${receiptNumber(data.number)}`}
      className="print-area flex flex-col gap-5 rounded-xl border border-border bg-surface p-5 shadow-card sm:p-8"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{data.issuerName}</h2>
          {data.issuerAddress && <p className="text-sm text-muted">{data.issuerAddress}</p>}
          {(data.issuerPhone || data.issuerEmail) && (
            <p className="text-sm text-muted">{[data.issuerPhone, data.issuerEmail].filter(Boolean).join(' · ')}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-xl font-semibold tabular-nums">{receiptNumber(data.number)}</p>
          <p className="text-sm text-muted">
            {formatLongDate(data.issuedAt)} · {formatTime(data.issuedAt)}
          </p>
          {voided && (
            <Badge tone="danger" dot>
              Anulado{data.voidedAt ? ` em ${formatLongDate(data.voidedAt)}` : ''}
            </Badge>
          )}
        </div>
      </header>

      <p className="text-sm">
        <span className="text-muted">Paciente: </span>
        <span className="font-medium">{data.patientName}</span>
      </p>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="py-2 font-medium">Descrição</th>
            <th className="py-2 text-right font-medium">Valor</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((line, index) => (
            <tr key={index} className="border-b border-border">
              <td className="py-2 pr-3">{line.description}</td>
              <td className="py-2 text-right tabular-nums">{formatMinor(line.amountMinor, data.currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="pt-3 font-semibold">Total</td>
            <td className={`pt-3 text-right text-base font-semibold tabular-nums ${voided ? 'line-through' : ''}`}>
              {formatMinor(data.totalMinor, data.currency)}
            </td>
          </tr>
        </tfoot>
      </table>

      <p className="text-sm">
        <span className="text-muted">Pagamento: </span>
        {paymentMethodLabel[data.paymentMethod]}
        <span className="text-muted"> (informativo)</span>
      </p>
      {data.note && <p className="text-sm">“{data.note}”</p>}

      <footer className="border-t border-border pt-3 text-center text-sm font-medium">
        Documento não fiscal
        <span className="block text-xs font-normal text-muted">{data.notice ?? RECEIPT_NOTICE}</span>
      </footer>
    </article>
  )
}

/** "Imprimir / Guardar PDF": usa a impressão do navegador (OP-41, sem PDF no servidor). */
export function PrintReceiptButton() {
  return (
    <Button
      variant="secondary"
      className="no-print"
      icon={<Printer className="size-4" aria-hidden />}
      onClick={() => window.print()}
    >
      Imprimir / Guardar PDF
    </Button>
  )
}
