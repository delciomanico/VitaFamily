import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
}

/**
 * Folha inferior (bottom sheet) baseada em <dialog>: foco preso, Esc fecha, toque fora fecha.
 * Fica sempre colada ao fundo, na coluna da app (nunca espalhada em ecrã largo).
 */
export function Sheet({ open, onClose, title, description, children, footer }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => event.target === ref.current && onClose()}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className="mx-auto mt-auto mb-0 max-h-[90dvh] w-full max-w-[34rem] animate-sheet-in overflow-y-auto rounded-t-3xl bg-surface p-0 text-foreground shadow-overlay"
    >
      <div className="app-mobile flex flex-col gap-4 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <span className="mx-auto h-1.5 w-12 rounded-full bg-border-strong" aria-hidden />
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <h2 id={titleId} className="text-xl font-semibold text-balance">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="text-base text-muted">
                {description}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="-me-2 flex size-12 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-muted">
            <X className="size-6" aria-hidden />
          </button>
        </div>
        {children}
        {footer && <div className="flex flex-col gap-3">{footer}</div>}
      </div>
    </dialog>
  )
}

interface ConfirmSheetProps {
  open: boolean
  title: string
  description?: string
  /** Texto do botão principal; começa por «Sim» (ex.: «Sim, confirmar»). */
  yesLabel?: string
  noLabel?: string
  destructive?: boolean
  loading?: boolean
  onYes: () => void
  onNo: () => void
  children?: ReactNode
}

/** Confirmação de uma ação: pergunta clara e dois botões grandes, «Sim…» e «Não». */
export function ConfirmSheet({ open, title, description, yesLabel = 'Sim', noLabel = 'Não', destructive = false, loading = false, onYes, onNo, children }: ConfirmSheetProps) {
  return (
    <Sheet
      open={open}
      onClose={onNo}
      title={title}
      description={description}
      footer={
        <>
          <Button size="xl" variant={destructive ? 'danger' : 'primary'} fullWidth onClick={onYes} loading={loading}>
            {yesLabel}
          </Button>
          <Button size="xl" variant="secondary" fullWidth onClick={onNo} disabled={loading}>
            {noLabel}
          </Button>
        </>
      }
    >
      {children}
    </Sheet>
  )
}
