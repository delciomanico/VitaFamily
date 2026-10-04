import { cn } from '@/lib/cn'

interface LogoProps {
  /** Mostra o nome ao lado do símbolo. */
  withName?: boolean
  size?: 'sm' | 'lg'
  className?: string
}

interface LogoMarkProps {
  className?: string
  /** `inverse`: símbolo branco para fundos de cor (splash). */
  tone?: 'default' | 'inverse'
}

export function LogoMark({ className, tone = 'default' }: LogoMarkProps) {
  const base = tone === 'inverse' ? '#fff' : 'var(--color-primary)'
  const heart = tone === 'inverse' ? 'var(--color-brand)' : '#fff'
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden>
      <rect width="512" height="512" rx="112" fill={base} />
      <path
        d="M256 404s-132-78-132-178c0-48 36-82 80-82 26 0 44 12 52 24 8-12 26-24 52-24 44 0 80 34 80 82 0 100-132 178-132 178z"
        fill={heart}
      />
      <path d="M236 206h40v36h36v40h-36v36h-40v-36h-36v-40h36z" fill={base} />
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
