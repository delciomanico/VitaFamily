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

/** Entrada de uma lista de menu, plana e alinhada (sem cartão): ícone, título curto, subtítulo de estado e seta. Toda a linha é o alvo de toque. */
export function ListEntry({ to, icon: Icon, title, subtitle, trailing, tone = 'default', className }: ListEntryProps) {
  return (
    <Link to={to} className={cn('flex items-center gap-4 rounded-2xl transition-colors active:bg-surface-muted', className)}>
      <span
        className={cn(
          'flex size-12 shrink-0 items-center justify-center rounded-2xl',
          toneTile[tone === 'default' ? 'brand' : tone],
        )}
      >
        <Icon className="size-6" aria-hidden />
      </span>
      {/* Linha fina por baixo do texto (começa depois do ícone), como nas listas de mensagens. */}
      <span className="flex min-h-[4.25rem] min-w-0 flex-1 items-center gap-3 border-b border-border py-3">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-display text-lg leading-6 font-semibold">{title}</span>
          {subtitle && <span className="text-sm text-muted">{subtitle}</span>}
        </span>
        {trailing}
        <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
      </span>
    </Link>
  )
}
