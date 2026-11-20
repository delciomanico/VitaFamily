import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

interface ListEntryProps {
  to: string
  icon: LucideIcon
  title: string
  /** Estado em linguagem simples (ex.: «3 ofertas ativas»). */
  subtitle?: string
  /** Contador/etiqueta à direita. */
  trailing?: ReactNode
  tone?: 'default' | 'attention'
  className?: string
}

/** Entrada grande de uma lista de menu: ícone, título curto, subtítulo de estado e seta. Toda a linha é o alvo de toque. */
export function ListEntry({ to, icon: Icon, title, subtitle, trailing, tone = 'default', className }: ListEntryProps) {
  return (
    <Link
      to={to}
      className={cn(
        'flex min-h-[4.5rem] items-center gap-4 rounded-2xl border border-border bg-surface px-4 py-3 shadow-card transition-colors hover:border-border-strong active:bg-surface-muted',
        className,
      )}
    >
      <span
        className={cn(
          'flex size-12 shrink-0 items-center justify-center rounded-xl',
          tone === 'attention' ? 'bg-warning-soft text-warning' : 'bg-primary-soft text-primary',
        )}
      >
        <Icon className="size-6" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-lg leading-6 font-semibold">{title}</span>
        {subtitle && <span className="text-base text-muted">{subtitle}</span>}
      </span>
      {trailing}
      <ChevronRight className="size-6 shrink-0 text-muted" aria-hidden />
    </Link>
  )
}
