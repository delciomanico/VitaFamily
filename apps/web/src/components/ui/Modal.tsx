import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
}

/**
 * Modal baseado em <dialog> nativo: foco preso, Esc fecha e o backdrop é do browser.
 * No mobile aparece como folha inferior; a partir de md, centrado.
 */
export function Modal({ open, onClose, title, description, children, footer }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
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
      className="m-0 mt-auto w-full max-w-none rounded-t-xl bg-surface p-0 text-foreground shadow-overlay md:m-auto md:max-w-md md:rounded-xl"
    >
      <div className="flex flex-col gap-4 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="text-sm text-muted">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-m-2 rounded-md p-2 text-muted hover:bg-surface-muted"
            aria-label="Fechar"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        {children}
        {footer && <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">{footer}</div>}
      </div>
    </dialog>
  )
}
