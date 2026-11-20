import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { toneTile, type Tone } from '@/lib/tones'

interface ListEntryProps {
  to: string
  icon: LucideIcon
  title: string
  /** Estado em linguagem simples (ex.: «3 ofertas ativas»). */
  subtitle?: string
  /** Contador/etiqueta à direita. */
  trailing?: ReactNode
  /** Cor da área do ícone («default» = azul da marca). */
  tone?: 'default' | Tone
  className?: string
}

/** Entrada grande de uma lista de menu: ícone, título curto, subtítulo de estado e seta. Toda a linha é o alvo de toque. */
export function ListEntry({ to, icon: Icon, title, subtitle, trailing, tone = 'default', className }: ListEntryProps) {
  return (
    <Link
      to={to}
      className={cn(
        'flex min-h-[4.5rem] items-center gap-4 rounded-[1.25rem] bg-surface px-4 py-3 shadow-card transition-transform active:scale-[0.98]',
        className,
      )}
    >
      <span
        className={cn(
          'flex size-12 shrink-0 items-center justify-center rounded-2xl',
          toneTile[tone === 'default' ? 'brand' : tone],
        )}
      >
        <Icon className="size-6" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-display text-xl leading-6 font-bold">{title}</span>
        {subtitle && <span className="text-base text-muted">{subtitle}</span>}
      </span>
      {trailing}
      <ChevronRight className="size-6 shrink-0 text-muted" aria-hidden />
    </Link>
  )
}
