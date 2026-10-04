import { cn } from '@/lib/cn'

type Size = 'sm' | 'md' | 'lg' | 'xl'

const sizes: Record<Size, string> = {
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-12 text-base',
  xl: 'size-20 text-xl',
}

interface AvatarProps {
  name: string
  src?: string
  size?: Size
  className?: string
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}

export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  const classes = cn('inline-flex shrink-0 items-center justify-center rounded-full', sizes[size], className)

  if (src) return <img src={src} alt={name} className={cn(classes, 'object-cover')} />

  return (
    <span className={cn(classes, 'bg-primary-soft font-semibold text-primary')} role="img" aria-label={name}>
      {initials(name)}
    </span>
  )
}
