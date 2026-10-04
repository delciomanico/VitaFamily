import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Card } from './Card'

/** Lista de pares rótulo/valor num cartão (detalhes de perfil, receita, medicamento). */
export function InfoList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card className={cn('py-0', className)}>
      <dl className="divide-y divide-border">{children}</dl>
    </Card>
  )
}

export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt className="shrink-0 text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{value}</dd>
    </div>
  )
}

/** Título de secção discreto, usado nas páginas de detalhe. */
export function DetailSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-muted">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}
