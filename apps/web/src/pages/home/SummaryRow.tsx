import { Link } from 'react-router-dom'
import { ChevronRight, type LucideIcon } from 'lucide-react'

interface SummaryRowProps {
  to: string
  icon: LucideIcon
  label: string
  value: string
}

/** Linha de resumo navegável dentro de um cartão (ex.: Medicamentos · 1 lembrete). */
export function SummaryRow({ to, icon: Icon, label, value }: SummaryRowProps) {
  return (
    <Link to={to} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-3 transition-colors hover:bg-surface-muted">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-muted text-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-muted">{label}</span>
        <span className="block font-medium">{value}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
    </Link>
  )
}
