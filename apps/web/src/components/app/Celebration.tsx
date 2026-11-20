import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

const BITS = [
  { dx: '-4.5rem', dy: '-3rem', color: 'bg-sun', size: 'size-3' },
  { dx: '4.5rem', dy: '-3.5rem', color: 'bg-health', size: 'size-2.5' },
  { dx: '-3rem', dy: '-5rem', color: 'bg-meds', size: 'size-2' },
  { dx: '3.25rem', dy: '-5rem', color: 'bg-family', size: 'size-3' },
  { dx: '-5.25rem', dy: '0.5rem', color: 'bg-accent', size: 'size-2.5' },
  { dx: '5.25rem', dy: '0.25rem', color: 'bg-sun', size: 'size-2' },
  { dx: '-3.5rem', dy: '3.5rem', color: 'bg-health', size: 'size-2' },
  { dx: '3.5rem', dy: '3.5rem', color: 'bg-meds', size: 'size-2.5' },
]

/**
 * Pequeno momento de celebração ao concluir uma ação (marcar, enviar…): o ícone «salta» e uns confetes
 * saem uma só vez. Só decoração (`aria-hidden`); com movimento reduzido fica o ícone parado.
 */
export function Celebration({ icon: Icon, tone = 'success', className }: { icon: LucideIcon; tone?: 'success' | 'warning'; className?: string }) {
  return (
    <span className={cn('relative flex size-24 items-center justify-center', className)} aria-hidden>
      {BITS.map((bit, index) => (
        <span
          key={index}
          className={cn('absolute rounded-full motion-reduce:hidden animate-confetti', bit.color, bit.size)}
          style={{ ['--dx' as string]: bit.dx, ['--dy' as string]: bit.dy, animationDelay: `${120 + index * 30}ms` }}
        />
      ))}
      <span
        className={cn(
          'animate-pop flex size-20 items-center justify-center rounded-full',
          tone === 'success' ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning',
        )}
      >
        <Icon className="size-10" strokeWidth={1.9} />
      </span>
    </span>
  )
}
