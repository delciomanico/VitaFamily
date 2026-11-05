import type { MetricPoint } from '@/types/wearable'

const WIDTH = 340
const HEIGHT = 190
const PAD_X = 30
const PAD_TOP = 16
const PAD_BOTTOM = 26

interface SeriesChartProps {
  points: MetricPoint[]
  kind: 'line' | 'bars'
  label: string
  unit?: string
}

/** Máximo de rótulos no eixo X, para não se sobreporem. */
const MAX_X_LABELS = 8

/**
 * Gráfico de série temporal (linha ou barras) em SVG, no mesmo estilo do `TrendChart`.
 * Mostra só os valores; não sombreia faixas nem assinala nada como normal/anormal.
 * Se os pontos tiverem `value2`, desenha uma segunda linha (ex.: diastólica).
 */
export function SeriesChart({ points, kind, label, unit }: SeriesChartProps) {
  if (points.length === 0) return null
  const all = points.flatMap((p) => (p.value2 === undefined ? [p.value] : [p.value, p.value2]))
  const rawMin = kind === 'bars' ? 0 : Math.min(...all)
  const rawMax = Math.max(...all)
  const padding = kind === 'bars' ? 0 : (rawMax - rawMin || 1) * 0.15
  const min = rawMin - padding
  const max = rawMax + padding
  const span = max - min || 1
  const innerW = WIDTH - 2 * PAD_X
  const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM
  const step = innerW / points.length
  const x = (i: number) => PAD_X + step * i + step / 2
  const y = (v: number) => PAD_TOP + (1 - (v - min) / span) * innerH
  const labelEvery = Math.ceil(points.length / MAX_X_LABELS)
  const barWidth = Math.max(2, Math.min(24, step * 0.65))
  const line = (pick: (p: MetricPoint) => number | undefined) =>
    points.flatMap((p, i) => (pick(p) === undefined ? [] : [`${x(i)},${y(pick(p) as number)}`])).join(' ')

  const ticks = [rawMax, (rawMax + rawMin) / 2, rawMin].map((v) => Math.round(v * 10) / 10)

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" role="img" aria-label={label}>
      {ticks.map((tick, i) => (
        <g key={i}>
          <line x1={PAD_X} x2={WIDTH - 6} y1={y(tick)} y2={y(tick)} className="stroke-border" strokeDasharray="3 3" />
          <text x={PAD_X - 4} y={y(tick) + 3} textAnchor="end" className="fill-muted text-[9px]">
            {tick}
          </text>
        </g>
      ))}
      {kind === 'bars' &&
        points.map((p, i) => (
          <rect
            key={i}
            x={x(i) - barWidth / 2}
            y={y(p.value)}
            width={barWidth}
            height={Math.max(1, y(min) - y(p.value))}
            rx={2}
            className="fill-primary"
          />
        ))}
      {kind === 'line' && (
        <>
          {points.some((p) => p.min !== undefined && p.max !== undefined) && (
            <polygon
              points={[
                ...points.map((p, i) => `${x(i)},${y(p.max ?? p.value)}`),
                ...[...points].reverse().map((p, i) => `${x(points.length - 1 - i)},${y(p.min ?? p.value)}`),
              ].join(' ')}
              className="fill-primary-soft"
            />
          )}
          {points.some((p) => p.value2 !== undefined) && (
            <polyline
              points={line((p) => p.value2)}
              fill="none"
              className="stroke-muted"
              strokeWidth={2}
              strokeLinejoin="round"
            />
          )}
          <polyline points={line((p) => p.value)} fill="none" className="stroke-primary" strokeWidth={2.5} strokeLinejoin="round" />
          {points.length <= 14 &&
            points.map((p, i) => (
              <circle key={i} cx={x(i)} cy={y(p.value)} r={3.5} className="fill-surface stroke-primary" strokeWidth={2} />
            ))}
        </>
      )}
      {points.map((p, i) =>
        i % labelEvery === 0 ? (
          <text key={i} x={x(i)} y={HEIGHT - 8} textAnchor="middle" className="fill-muted text-[9px]">
            {p.label}
          </text>
        ) : null,
      )}
      {unit && (
        <text x={WIDTH - 6} y={10} textAnchor="end" className="fill-muted text-[9px]">
          {unit}
        </text>
      )}
    </svg>
  )
}
