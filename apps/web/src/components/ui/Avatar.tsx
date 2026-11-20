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

/** Cada pessoa tem sempre a mesma cor (pelo nome): ajuda a reconhecer quem é de relance. `-ink` cumpre AA sobre `-soft`. */
const avatarTones = ['bg-primary-soft text-primary', 'bg-health-soft text-health-ink', 'bg-meds-soft text-meds-ink', 'bg-chat-soft text-chat-ink', 'bg-family-soft text-family-ink']

function toneFor(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 997
  return avatarTones[hash % avatarTones.length]!
}

export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  const classes = cn('inline-flex shrink-0 items-center justify-center rounded-full', sizes[size], className)

  if (src) return <img src={src} alt={name} className={cn(classes, 'object-cover')} />

  return (
    <span className={cn(classes, 'font-display font-bold', toneFor(name))} role="img" aria-label={name}>
      {initials(name)}
    </span>
  )
}
