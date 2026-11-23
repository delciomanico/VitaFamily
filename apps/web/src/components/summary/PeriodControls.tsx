import { useState } from 'react'
import { Sheet } from '@/components/app/Sheet'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/cn'
import { todayISO } from '@/lib/date'
import { formatShortDate } from '@/lib/format'
import { rangeProblem, type SummaryRange, type SummaryShortcut } from '@/lib/summaryPeriod'

const chips: Array<{ value: SummaryShortcut; label: string }> = [
  { value: '30', label: '30 dias' },
  { value: '90', label: '90 dias' },
  { value: '12m', label: '12 meses' },
]

interface Props {
  value: SummaryShortcut
  range: SummaryRange
  onShortcut: (shortcut: Exclude<SummaryShortcut, 'custom'>) => void
  onCustom: (range: SummaryRange) => void
}

/** Período: atalhos de 30/90 dias e 12 meses, e «Escolher datas» numa folha (máx. 5 anos). */
export function PeriodControls({ value, range, onShortcut, onCustom }: Props) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(range.from)
  const [to, setTo] = useState(range.to)
  const [error, setError] = useState<string | null>(null)
  const chip = (active: boolean) =>
    cn('min-h-12 rounded-full border px-1 text-base font-medium whitespace-nowrap transition-colors', active ? 'border-primary bg-primary font-semibold text-primary-foreground' : 'border-border bg-surface text-foreground active:bg-surface-muted')

  function apply() {
    const next = { from, to }
    const problem = rangeProblem(next)
    setError(problem)
    if (problem) return
    onCustom(next)
    setOpen(false)
  }

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Período" className="grid grid-cols-4 gap-1.5 py-1">
        {chips.map((c) => (
          <button key={c.value} type="button" aria-pressed={value === c.value} onClick={() => onShortcut(c.value as Exclude<SummaryShortcut, 'custom'>)} className={chip(value === c.value)}>
            {c.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={value === 'custom'}
          aria-label="Escolher datas"
          onClick={() => {
            setFrom(range.from)
            setTo(range.to)
            setError(null)
            setOpen(true)
          }}
          className={chip(value === 'custom')}
        >
          Datas
        </button>
      </div>
      <p className="text-sm text-muted">
        De {formatShortDate(range.from)} a {formatShortDate(range.to)}
      </p>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Escolher datas"
        description="Pode ver até 5 anos."
        footer={
          <Button size="xl" fullWidth onClick={apply}>
            Ver este período
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <Input label="De" type="date" value={from} max={todayISO()} onChange={(e) => setFrom(e.target.value)} />
          <Input label="Até" type="date" value={to} max={todayISO()} onChange={(e) => setTo(e.target.value)} error={error ?? undefined} />
        </div>
      </Sheet>
    </div>
  )
}
