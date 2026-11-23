import type { ReactNode } from 'react'
import { Check, ScanSearch, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

/**
 * Campo que veio da leitura da foto e pode estar mal lido (confiança < 0,70, BR-OCR-07): leva contorno tracejado,
 * ícone e o texto «Confirmar» — nunca só cor. Tocar em «Confirmar» (ou corrigir o campo) resolve a marca.
 */
export function MarkedField({ pending, onConfirm, children }: { pending: boolean; onConfirm: () => void; children: ReactNode }) {
  if (!pending) return <>{children}</>
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border-2 border-dashed border-warning p-2.5" data-ocr-pending>
      {children}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-base font-medium text-warning">
          <TriangleAlert className="size-5 shrink-0" aria-hidden />
          Pode estar mal lido
        </p>
        <Button variant="secondary" size="lg" onClick={onConfirm} icon={<ScanSearch className="size-5" aria-hidden />}>
          Confirmar
        </Button>
      </div>
    </div>
  )
}

/** Resumo no topo do formulário: quantos campos faltam confirmar, ou «tudo revisto». */
export function ReviewBanner({ pending, notice }: { pending: number; notice?: string | null }) {
  return (
    <div className="flex flex-col gap-2" data-testid="ocr-banner">
      {notice && <p className="rounded-xl bg-primary-soft px-3.5 py-3 text-base text-primary">{notice}</p>}
      <p
        role="status"
        className={cn(
          'flex items-start gap-2 rounded-xl border px-3.5 py-3 text-base',
          pending > 0 ? 'border-warning bg-warning-soft text-warning' : 'border-success bg-success-soft text-success',
        )}
      >
        {pending > 0 ? <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden /> : <Check className="mt-0.5 size-5 shrink-0" aria-hidden />}
        {pending > 0
          ? `Falta confirmar ${pending} ${pending === 1 ? 'campo assinalado' : 'campos assinalados'} para poder guardar.`
          : 'Tudo revisto. Pode guardar.'}
      </p>
    </div>
  )
}
