import type { HTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'

const base = 'rounded-lg border border-border bg-surface shadow-card'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(base, 'p-4', className)} {...props} />
}

interface CardLinkProps {
  to: string
  children: ReactNode
  className?: string
  /** Mostra a seta à direita (padrão: sim). */
  chevron?: boolean
}

/** Cartão navegável: todo o cartão é um link. */
export function CardLink({ to, children, className, chevron = true }: CardLinkProps) {
  return (
    <Link
      to={to}
      className={cn(
        base,
        'flex items-center gap-3 p-4 transition-colors hover:border-border-strong active:bg-surface-muted',
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {chevron && <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />}
    </Link>
  )
}

interface SectionProps {
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
}

/** Secção de página com título e ação opcional (ex.: “Ver tudo”). */
export function Section({ title, action, children, className }: SectionProps) {
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}
