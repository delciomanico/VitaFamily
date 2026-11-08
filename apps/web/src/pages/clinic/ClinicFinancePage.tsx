import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Receipt } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Tabs } from '@/components/ui/Tabs'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { todayISO } from '@/lib/date'
import { errorMessage } from '@/lib/errors'
import { formatShortDate, formatTime } from '@/lib/format'
import { formatMinor, paymentMethodLabel, receiptNumber, receiptStatusLabel } from '@/lib/receipt'
import { paths } from '@/routes/paths'
import { clinicReceiptService } from '@/services/clinicReceipt.service'
import type { ClinicReceipt, ClinicReceiptSummary, ReceiptStatus } from '@/types/clinicReceipt'

type Period = 'today' | '7' | 'month' | 'custom'

const PERIODS = [
  { value: 'today', label: 'Hoje' },
  { value: '7', label: '7 dias' },
  { value: 'month', label: 'Este mês' },
  { value: 'custom', label: 'Datas' },
] as const

/** Dias locais [from, to] inclusivos de cada período pré-definido. */
function rangeOf(period: Exclude<Period, 'custom'>): { from: string; to: string } {
  const now = new Date()
  const to = todayISO(now)
  if (period === 'today') return { from: to, to }
  if (period === '7') {
    const start = new Date(now)
    start.setDate(start.getDate() - 6)
    return { from: todayISO(start), to }
  }
  return { from: todayISO(new Date(now.getFullYear(), now.getMonth(), 1)), to }
}

interface Loaded {
  items: ClinicReceipt[]
  nextCursor: string | null
  summary: ClinicReceiptSummary
}
type LoadState = { status: 'loading' } | { status: 'error'; message: string } | ({ status: 'success' } & Loaded)

const PAGE_SIZE = 25

/**
 * Financeiro (UC-CLN-27, BR-CLN-37): recibos do período com o total emitido (os anulados não somam)
 * e ligação a cada recibo para imprimir. Só Admin e Gestor; sem exportação nem gráficos.
 */
export function ClinicFinancePage() {
  const [period, setPeriod] = useState<Period>('month')
  const [custom, setCustom] = useState(() => rangeOf('7'))
  const [status, setStatus] = useState<'' | ReceiptStatus>('')
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [loadingMore, setLoadingMore] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const range = period === 'custom' ? custom : rangeOf(period)
  const invalidRange = !range.from || !range.to || range.to < range.from

  useEffect(() => {
    if (invalidRange) return
    let active = true
    setState({ status: 'loading' })
    clinicReceiptService.list({ from: range.from, to: range.to, status: status || undefined, limit: PAGE_SIZE }).then(
      (page) => active && setState({ status: 'success', ...page }),
      (error: unknown) => active && setState({ status: 'error', message: errorMessage(error) }),
    )
    return () => {
      active = false
    }
  }, [range.from, range.to, status, attempt, invalidRange])

  async function loadMore() {
    if (state.status !== 'success' || !state.nextCursor) return
    setLoadingMore(true)
    try {
      const page = await clinicReceiptService.list({
        from: range.from,
        to: range.to,
        status: status || undefined,
        limit: PAGE_SIZE,
        cursor: state.nextCursor,
      })
      setState({ ...state, items: [...state.items, ...page.items], nextCursor: page.nextCursor, summary: page.summary })
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) })
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Financeiro</h1>
        <p className="text-sm text-muted">Recibos internos, sem valor fiscal. Os recibos anulados não entram no total.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Tabs label="Período" items={[...PERIODS]} value={period} onChange={setPeriod} className="w-full max-w-md" />
        <div className="w-44">
          <Select
            label="Estado"
            value={status}
            options={[
              { value: 'ISSUED', label: 'Emitidos' },
              { value: 'VOIDED', label: 'Anulados' },
            ]}
            placeholder="Todos"
            onChange={(event) => setStatus(event.target.value as '' | ReceiptStatus)}
          />
        </div>
      </div>
      {period === 'custom' && (
        <div className="flex flex-wrap gap-3">
          <Input label="De" type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
          <Input label="Até" type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
        </div>
      )}
      {invalidRange && <FormError message="Escolha um período válido (a data final não pode ser anterior à inicial)." />}

      {!invalidRange && state.status === 'loading' && <LoadingState rows={3} />}
      {!invalidRange && state.status === 'error' && <ErrorState message={state.message} onRetry={() => setAttempt((n) => n + 1)} />}
      {!invalidRange && state.status === 'success' && (
        <>
          <section aria-label="Total do período" className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4 shadow-card">
              <p className="text-sm text-muted">Total emitido</p>
              <p className="text-2xl font-semibold tabular-nums">
                {formatMinor(state.summary.issuedTotalMinor, state.summary.currency)}
              </p>
              <p className="text-sm text-muted">
                {state.summary.issuedCount === 1 ? '1 recibo emitido' : `${state.summary.issuedCount} recibos emitidos`}
              </p>
            </div>
            <div className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4 shadow-card">
              <p className="text-sm text-muted">Anulados (fora do total)</p>
              <p className="text-2xl font-semibold tabular-nums">{state.summary.voidedCount}</p>
            </div>
          </section>

          {state.items.length > 0 ? (
            <Card className="divide-y divide-border py-1">
              {state.items.map((receipt) => (
                <Link
                  key={receipt.id}
                  to={paths.clinicReceipt(receipt.id)}
                  className="flex items-center gap-3 py-3 hover:bg-surface-muted"
                >
                  <span className="w-24 shrink-0 font-semibold tabular-nums">{receiptNumber(receipt.number)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{receipt.patientName}</span>
                    <span className="block truncate text-sm text-muted">
                      {formatShortDate(receipt.issuedAt)} · {formatTime(receipt.issuedAt)} ·{' '}
                      {paymentMethodLabel[receipt.paymentMethod]}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <span className={`font-semibold tabular-nums ${receipt.status === 'VOIDED' ? 'text-muted line-through' : ''}`}>
                      {formatMinor(receipt.totalMinor, receipt.currency)}
                    </span>
                    <Badge tone={receipt.status === 'VOIDED' ? 'danger' : 'success'} dot>
                      {receiptStatusLabel[receipt.status]}
                    </Badge>
                  </span>
                </Link>
              ))}
              {state.nextCursor && (
                <div className="flex justify-center py-3">
                  <Button variant="secondary" size="sm" loading={loadingMore} onClick={() => void loadMore()}>
                    Carregar mais
                  </Button>
                </div>
              )}
            </Card>
          ) : (
            <EmptyState
              icon={Receipt}
              title="Sem recibos neste período."
              description="Emita um recibo numa consulta ou exame concluído, em Hoje, na Agenda ou na ficha do paciente."
            />
          )}
        </>
      )}
    </>
  )
}
