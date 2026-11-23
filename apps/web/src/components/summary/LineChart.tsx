import { formatDayMonth } from '@/lib/format'
import { formatNumber } from '@/lib/summaryText'

const WIDTH = 320
const HEIGHT = 140
const PAD_X = 14
const PAD_TOP = 14
const PAD_BOTTOM = 26

interface LineChartProps {
  points: Array<{ date: string; value: number }>
  /** Descrição para leitores de ecrã (o gráfico em si é só apoio visual). */
  label: string
  /** Gráfico pequeno (linha de lista): sem eixos nem datas. */
  compact?: boolean
}

/**
 * Gráfico de linha em SVG próprio (sem bibliotecas). Mostra só os valores registados: sem faixas de
 * referência, sem cores de «bom/mau» (BR-EXM-02). Um só ponto aparece como ponto.
 */
export function LineChart({ points, label, compact = false }: LineChartProps) {
  if (points.length === 0) return null
  const height = compact ? 36 : HEIGHT
  const padTop = compact ? 6 : PAD_TOP
  const padBottom = compact ? 6 : PAD_BOTTOM
  const values = points.map((p) => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const innerW = WIDTH - 2 * PAD_X
  const x = (i: number) => (points.length === 1 ? WIDTH / 2 : PAD_X + (innerW * i) / (points.length - 1))
  const y = (v: number) => (max === min ? height / 2 : padTop + (1 - (v - min) / span) * (height - padTop - padBottom))
  const path = points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')
  const lastIndex = points.length - 1
  return (
    <svg viewBox={`0 0 ${WIDTH} ${height}`} className="h-auto w-full" role="img" aria-label={label}>
      {!compact && (
        <>
          <line x1={PAD_X} x2={WIDTH - PAD_X} y1={y(max)} y2={y(max)} className="stroke-border" strokeDasharray="3 3" />
          <line x1={PAD_X} x2={WIDTH - PAD_X} y1={y(min)} y2={y(min)} className="stroke-border" strokeDasharray="3 3" />
          <text x={PAD_X} y={y(max) - 4} className="fill-muted text-[10px]">
            {formatNumber(max)}
          </text>
          {max !== min && (
            <text x={PAD_X} y={y(min) - 4} className="fill-muted text-[10px]">
              {formatNumber(min)}
            </text>
          )}
          <text x={PAD_X} y={height - 8} className="fill-muted text-[10px]">
            {formatDayMonth(points[0]!.date)}
          </text>
          {points.length > 1 && (
            <text x={WIDTH - PAD_X} y={height - 8} textAnchor="end" className="fill-muted text-[10px]">
              {formatDayMonth(points[lastIndex]!.date)}
            </text>
          )}
        </>
      )}
      {points.length > 1 && <polyline points={path} fill="none" className="stroke-primary" strokeWidth={compact ? 2 : 2.5} strokeLinejoin="round" strokeLinecap="round" />}
      {points.length <= 24 &&
        points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r={compact ? 2.5 : 4} className="fill-surface stroke-primary" strokeWidth={2} />)}
      <circle cx={x(lastIndex)} cy={y(points[lastIndex]!.value)} r={compact ? 3 : 5} className="fill-primary" />
    </svg>
  )
}
