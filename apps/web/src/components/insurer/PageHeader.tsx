import type { ReactNode } from 'react'

/** Título de página do portal da seguradora, com a ação principal à direita e texto de apoio. */
export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        {action}
      </div>
      {description && <p className="text-sm text-muted">{description}</p>}
    </div>
  )
}
