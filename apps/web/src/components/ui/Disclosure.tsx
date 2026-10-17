import { useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'

interface DisclosureProps {
  label: string
  children: ReactNode
  defaultOpen?: boolean
  /** Controla a abertura de fora (ex.: abrir automaticamente depois de um preenchimento por OCR). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}

/**
 * Revela campos secundários só quando pedidos (ex.: "+ Médico e clínica" num formulário).
 * Reduz o número de campos visíveis de início sem remover nenhum — quem precisa, abre.
 */
export function Disclosure({
  label,
  children,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  className,
}: DisclosureProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const open = openProp ?? internalOpen
  const contentId = useId()

  function toggle() {
    const next = !open
    onOpenChange?.(next)
    if (openProp === undefined) setInternalOpen(next)
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex items-center gap-1.5 self-start text-sm font-medium text-primary hover:underline"
      >
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
        {label}
      </button>
      {open && (
        <div id={contentId} className="flex flex-col gap-4">
          {children}
        </div>
      )}
    </div>
  )
}
