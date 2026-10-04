import { formatNumber } from '@/lib/examination'

export interface TrendPoint {
  label: string
  value: number
}

const WIDTH = 320
const HEIGHT = 150
const PAD_X = 28
const PAD_TOP = 26
const PAD_BOTTOM = 26

/**
 * Tendência simples de um parâmetro: linha com os valores por data.
 * Só desenha os valores registados; não sombreia faixas nem assinala nada (BR-EXM-02).
 */
export function TrendChart({ points, label }: { points: TrendPoint[]; label: string }) {
  const values = points.map((p) => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const x = (i: number) => (points.length === 1 ? WIDTH / 2 : PAD_X + (i * (WIDTH - 2 * PAD_X)) / (points.length - 1))
  const y = (v: number) => PAD_TOP + (1 - (v - min) / span) * (HEIGHT - PAD_TOP - PAD_BOTTOM)
  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="mx-auto h-auto w-full max-w-md" role="img" aria-label={label}>
      <line
        x1={PAD_X / 2}
        x2={WIDTH - PAD_X / 2}
        y1={HEIGHT - PAD_BOTTOM + 6}
        y2={HEIGHT - PAD_BOTTOM + 6}
        className="stroke-border"
      />
      <polyline points={line} fill="none" className="stroke-primary" strokeWidth={2.5} strokeLinejoin="round" />
      {points.map((point, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(point.value)} r={4.5} className="fill-surface stroke-primary" strokeWidth={2.5} />
          <text
            x={x(i)}
            y={y(point.value) - 10}
            textAnchor="middle"
            className="fill-foreground text-[11px] font-semibold"
          >
            {formatNumber(point.value)}
          </text>
          <text x={x(i)} y={HEIGHT - 6} textAnchor="middle" className="fill-muted text-[10px]">
            {point.label}
          </text>
        </g>
      ))}
    </svg>
  )
}
