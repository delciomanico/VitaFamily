import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { canNavigateBack } from '@/lib/navigation'

interface ScreenHeaderProps {
  title: string
  /** Destino do «Voltar» quando não há histórico da app (link direto, recarregar). */
  backTo: string
  /** Texto do «Voltar» (por omissão, «Voltar»). */
  backLabel?: string
  subtitle?: string
  action?: ReactNode
}

/**
 * Cabeçalho de um ecrã interior: «Voltar» sempre no mesmo canto, título grande por baixo.
 * Volta mesmo ao ecrã anterior quando a navegação veio da app; senão, ao destino fixo.
 */
export function ScreenHeader({ title, backTo, backLabel = 'Voltar', subtitle, action }: ScreenHeaderProps) {
  const navigate = useNavigate()
  return (
    <header className="sticky top-0 z-20 -mx-5 -mt-5 flex flex-col gap-2 bg-background px-5 pt-[max(1.25rem,var(--safe-top))] pb-2">
      <Link
        to={backTo}
        onClick={(event) => {
          event.preventDefault()
          if (canNavigateBack()) navigate(-1)
          else navigate(backTo, { replace: true })
        }}
        className="-ms-1 inline-flex min-h-12 w-fit items-center gap-1 rounded-full bg-primary-soft pe-4 ps-2 text-base font-semibold text-primary hover:bg-primary-soft-hover"
      >
        <ChevronLeft className="size-6" aria-hidden />
        {backLabel}
      </Link>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[1.25rem] leading-tight font-semibold text-balance">{title}</h1>
          {subtitle && <p className="mt-1 text-base text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
    </header>
  )
}

/** Título de um separador principal (sem «Voltar»). */
export function TabHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3 pt-1">
      <div className="min-w-0">
        <h1 className="text-[1.25rem] leading-tight font-semibold text-balance">{title}</h1>
        {subtitle && <p className="mt-1 text-base text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  )
}
