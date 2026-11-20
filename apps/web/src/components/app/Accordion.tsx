import { useId, useState, type ReactNode } from 'react'
import { ChevronDown, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

interface AccordionSectionProps {
  title: string
  /** Resumo visível com a secção fechada (ex.: «Comprovativo por analisar»). */
  summary?: string
  icon?: LucideIcon
  defaultOpen?: boolean
  /** Realça a secção onde há algo para fazer. */
  attention?: boolean
  children: ReactNode
}

/** Secção recolhível: o botão é o título inteiro (alvo ≥ 56 px); `aria-expanded` e foco visível. */
export function AccordionSection({ title, summary, icon: Icon, defaultOpen = false, attention = false, children }: AccordionSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()
  return (
    <section className={cn('overflow-hidden rounded-2xl border bg-surface shadow-card', attention ? 'border-warning/40' : 'border-border')}>
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-start focus-visible:outline-offset-[-2px]"
        >
          {Icon && (
            <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', attention ? 'bg-warning-soft text-warning' : 'bg-primary-soft text-primary')}>
              <Icon className="size-5" aria-hidden />
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-lg leading-6 font-semibold">{title}</span>
            {summary && !open && <span className="truncate text-base font-normal text-muted">{summary}</span>}
          </span>
          <ChevronDown className={cn('size-6 shrink-0 text-muted transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
      </h2>
      {open && (
        <div id={panelId} className="flex flex-col gap-3 border-t border-border px-4 py-4">
          {children}
        </div>
      )}
    </section>
  )
}
