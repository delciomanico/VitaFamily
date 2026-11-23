import { Sheet } from '@/components/app/Sheet'
import { formatShortDate } from '@/lib/format'
import { formatNumber, formatVariation } from '@/lib/summaryText'
import type { ExamParameterSeries } from '@/types/healthSummary'
import { LineChart } from './LineChart'
import { StatRow } from './SummaryParts'

/** Texto da referência tal como o utilizador a indicou; nunca comparada com o valor (BR-EXM-02). */
export function referenceText(series: ExamParameterSeries): string | null {
  if (series.referenceText) return series.referenceText
  const { referenceMin: min, referenceMax: max } = series
  if (min != null && max != null) return `${formatNumber(min)} a ${formatNumber(max)}`
  if (min != null) return `a partir de ${formatNumber(min)}`
  if (max != null) return `até ${formatNumber(max)}`
  return null
}

const withUnit = (value: number, unit: string) => `${formatNumber(value)}${unit ? ` ${unit}` : ''}`

/** Folha com o detalhe de um parâmetro: gráfico e os números (mínimo, máximo, primeiro, último, variação). */
export function ExamSeriesSheet({ series, onClose }: { series: ExamParameterSeries | null; onClose: () => void }) {
  const open = series !== null
  const reference = series ? referenceText(series) : null
  const pct = series ? formatVariation(series.variationPct, ' %') : null
  const abs = series ? formatVariation(series.variationAbs, series.unit ? ` ${series.unit}` : '') : null
  return (
    <Sheet open={open} onClose={onClose} title={series?.parameter ?? 'Valor'} description={series ? `${series.count === 1 ? '1 medição' : `${series.count} medições`} neste período` : undefined}>
      {series && (
        <div className="flex flex-col gap-3">
          {series.count > 1 && <LineChart points={series.points} label={`Evolução de ${series.parameter}: ${series.points.map((p) => `${formatShortDate(p.date)} ${withUnit(p.value, series.unit)}`).join('; ')}`} />}
          <div className="flex flex-col">
            {series.count === 1 ? (
              <StatRow label="Valor" value={withUnit(series.last, series.unit)} hint={series.points[0] ? formatShortDate(series.points[0].date) : undefined} />
            ) : (
              <>
            <StatRow label="Primeiro valor" value={withUnit(series.first, series.unit)} hint={series.points[0] ? formatShortDate(series.points[0].date) : undefined} />
            <StatRow label="Último valor" value={withUnit(series.last, series.unit)} hint={series.points.length ? formatShortDate(series.points[series.points.length - 1]!.date) : undefined} />
            <StatRow label="Mais baixo" value={withUnit(series.min, series.unit)} />
            <StatRow label="Mais alto" value={withUnit(series.max, series.unit)} />
            {pct && abs && <StatRow label="Variação" value={`${abs} (${pct})`} hint="Do primeiro ao último valor" />}
              </>
            )}
          </div>
          {reference && <p className="text-base text-muted">Referência indicada por si: {reference}{series.unit ? ` ${series.unit}` : ''}</p>}
          {series.truncated && <p className="text-sm text-muted">Mostramos as medições mais recentes.</p>}
          <p className="text-sm text-muted">Só números e datas que registou. Para saber o que significam, fale com o seu médico.</p>
        </div>
      )}
    </Sheet>
  )
}
