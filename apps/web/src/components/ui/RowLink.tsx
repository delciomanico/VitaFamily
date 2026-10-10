import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'

interface RowLinkProps {
  to: string
  /** Falso = linha só de leitura (ex.: dados partilhados, sem acesso ao detalhe). */
  linked?: boolean
  className?: string
  children: ReactNode
}

/** Linha de uma lista em cartão: ligação com seta, ou só leitura. */
export function RowLink({ to, linked = true, className, children }: RowLinkProps) {
  const classes = cn('-mx-2 flex items-center gap-3 rounded-md px-2 py-3', className)
  if (!linked) return <div className={classes}>{children}</div>
  return (
    <Link to={to} className={cn(classes, 'transition-colors hover:bg-surface-muted')}>
      {children}
      <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
    </Link>
  )
}
