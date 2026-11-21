import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface SunriseProps {
  /** Tomas feitas / total de hoje; sem total, só o sol (decoração). */
  done?: number
  total?: number
  className?: string
}

const RADIUS = 70
const ARC = Math.PI * RADIUS

/**
 * O elemento de identidade da app: um sol a nascer. As voltas à volta dele são o progresso do dia
 * (tomas feitas) — a arco cresce ao carregar. Sem total, é só o sol e as suas ondas.
 */
export function Sunrise({ done = 0, total = 0, className }: SunriseProps) {
  const hasTotal = total > 0
  const fraction = hasTotal ? Math.min(done / total, 1) : 0
  return (
    <svg
      viewBox="0 0 200 106"
      className={cn('block w-full', className)}
      role={hasTotal ? 'img' : undefined}
      aria-label={hasTotal ? `${done} de ${total} tomas de hoje` : undefined}
      aria-hidden={hasTotal ? undefined : true}
    >
      <circle cx="100" cy="100" r="98" fill="none" stroke="white" strokeOpacity="0.08" strokeWidth="1.5" />
      <circle cx="100" cy="100" r="84" fill="none" stroke="white" strokeOpacity="0.1" strokeWidth="1.5" />
      {hasTotal ? (
        <>
          <path d="M30 100 A70 70 0 0 1 170 100" fill="none" stroke="white" strokeOpacity="0.2" strokeWidth="11" strokeLinecap="round" />
          {fraction > 0 && (
            <path
              d="M30 100 A70 70 0 0 1 170 100"
              fill="none"
              stroke="var(--color-sun)"
              strokeWidth="11"
              strokeLinecap="round"
              strokeDasharray={`${ARC * fraction} ${ARC}`}
              className="animate-ring"
              style={{ ['--ring-len' as string]: `${ARC * fraction}` }}
            />
          )}
        </>
      ) : (
        <circle cx="100" cy="100" r="70" fill="none" stroke="white" strokeOpacity="0.12" strokeWidth="1.5" />
      )}
      <circle cx="100" cy="100" r="46" fill="var(--color-sun)" />
      {hasTotal && (
        <text x="100" y="92" textAnchor="middle" fontSize="30" fontWeight="800" fill="#4a2a00" style={{ fontFamily: 'var(--font-display)' }}>
          {done}/{total}
        </text>
      )}
    </svg>
  )
}

/** Faixa de topo de um ecrã inicial: azul profundo, cantos de baixo grandes, o sol a nascer no canto. */
export function HeroBand({ children, sun, className, image }: { children: ReactNode; sun?: ReactNode; className?: string; image?: string }) {
  return (
    <div
      className={cn('relative isolate overflow-hidden rounded-b-[2rem] bg-brand-deep pb-14 text-white', className)}
      style={
        image
          ? {
              // Foto com véu azul por cima: o texto branco e o sol ficam legíveis (AA).
              backgroundImage: `linear-gradient(180deg, rgb(13 79 104 / 0.62) 0%, rgb(13 79 104 / 0.84) 60%, rgb(10 60 80 / 0.94) 100%), url(${image})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center 30%',
            }
          : undefined
      }
    >
      <div className="relative">{children}</div>
      {sun && <div className="absolute right-2 bottom-8 w-48">{sun}</div>}
    </div>
  )
}
