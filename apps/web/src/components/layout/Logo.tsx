import { cn } from '@/lib/cn'

interface LogoProps {
  /** Mostra o nome ao lado do símbolo. */
  withName?: boolean
  size?: 'sm' | 'lg'
  className?: string
}

interface LogoMarkProps {
  className?: string
  /** `inverse`: símbolo num quadrado branco, para fundos de cor (splash, login). */
  tone?: 'default' | 'inverse'
}

/**
 * Símbolo do Vita Family: coração formado por uma folha (vida) e um lóbulo (família),
 * atravessado por uma linha de batimento. Desenhado para fundo branco; o mesmo desenho
 * está em public/favicon.svg (origem dos ícones da PWA).
 */
export function LogoMark({ className, tone = 'default' }: LogoMarkProps) {
  const mark = (
    <>
      <path
        d="M246 432C150 384 90 304 100 228C108 160 160 112 214 80C252 150 274 222 268 292C264 350 256 396 246 432Z"
        fill="var(--color-accent)"
      />
      <path
        d="M268 430C280 384 286 334 286 290C288 236 284 198 276 170C304 140 346 126 382 134C430 146 448 196 438 246C424 318 354 382 268 430Z"
        fill="var(--color-primary)"
      />
      <path d="M60 290H452" stroke="var(--color-brand)" strokeWidth="22" strokeLinecap="round" />
      {/* Troço branco por dentro do coração. */}
      <path
        d="M124 290H178L208 234L242 350L282 202L316 290H424"
        fill="none"
        stroke="#fff"
        strokeWidth="22"
        strokeLinejoin="round"
      />
    </>
  )
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden>
      {tone === 'inverse' ? (
        <>
          <rect width="512" height="512" rx="112" fill="#fff" />
          <g transform="translate(51 51) scale(0.8)">{mark}</g>
        </>
      ) : (
        mark
      )}
    </svg>
  )
}

export function Logo({ withName = true, size = 'sm', className }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark className={size === 'lg' ? 'size-16' : 'size-8'} />
      {withName && (
        <span className={cn('font-semibold tracking-tight', size === 'lg' ? 'text-2xl' : 'text-base')}>
          Vita Family
        </span>
      )}
    </span>
  )
}
