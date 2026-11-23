import { formatDayMonth } from '@/lib/format'
import { formatMonth } from '@/lib/summaryText'
import type { AdherenceBucket } from '@/types/healthSummary'

const MAX_BARS = 14

/** Barras da adesão por semana/mês (SVG próprio). Períodos sem tomas ficam vazios, nunca a 0 %. */
export function AdherenceBars({ series, granularity }: { series: AdherenceBucket[]; granularity: 'WEEK' | 'MONTH' }) {
  const shown = series.slice(-MAX_BARS)
  // Com um só período não há tendência para mostrar.
  if (shown.length < 2) return null
  const unit = granularity === 'WEEK' ? 'semana' : 'mês'
  const text = shown
    .map((b) => `${granularity === 'WEEK' ? `semana de ${formatDayMonth(b.periodStart)}` : formatMonth(b.periodStart.slice(0, 7))}: ${b.adherencePct === null ? 'sem tomas' : `${b.adherencePct} %`}`)
    .join('; ')
  return (
    <figure className="flex flex-col gap-1.5">
      <div role="img" aria-label={`Tomas confirmadas por ${unit}. ${text}`} className="flex h-20 items-end justify-between gap-1.5 border-b border-border">
        {shown.map((b) => (
          <span key={b.periodStart} className="flex h-full max-w-12 flex-1 items-end" aria-hidden>
            {b.adherencePct === null ? (
              <span className="h-px w-full bg-border-strong" />
            ) : (
              <span className="w-full rounded-t-md bg-primary" style={{ height: `${Math.max(b.adherencePct, 4)}%` }} />
            )}
          </span>
        ))}
      </div>
      <figcaption className="flex justify-between text-xs text-muted" aria-hidden>
        <span>{granularity === 'WEEK' ? formatDayMonth(shown[0]!.periodStart) : formatMonth(shown[0]!.periodStart.slice(0, 7))}</span>
        <span>por {unit}</span>
        <span>{granularity === 'WEEK' ? formatDayMonth(shown[shown.length - 1]!.periodStart) : formatMonth(shown[shown.length - 1]!.periodStart.slice(0, 7))}</span>
      </figcaption>
    </figure>
  )
}
