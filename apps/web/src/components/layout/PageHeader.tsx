import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'

interface PageHeaderProps {
  title: string
  description?: string
  /** Destino do botão voltar (páginas de detalhe). */
  backTo?: string
  backLabel?: string
  /** Ação principal (ex.: “+ Adicionar”). */
  action?: ReactNode
}

export function PageHeader({ title, description, backTo, backLabel = 'Voltar', action }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3">
      {backTo && (
        <Link
          to={backTo}
          className="-ml-2 inline-flex h-9 w-fit items-center gap-1 rounded-md pr-3 pl-1 text-sm font-medium text-muted hover:text-foreground"
        >
          <ChevronLeft className="size-5" aria-hidden />
          {backLabel}
        </Link>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-muted">{description}</p>}
        </div>
        {action}
      </div>
    </div>
  )
}
