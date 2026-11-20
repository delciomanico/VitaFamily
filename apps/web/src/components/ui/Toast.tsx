import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CircleCheck, CircleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'

const TOAST_DURATION_MS = 3500

type ToastTone = 'success' | 'error'

interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

interface ToastApi {
  show: (message: string, tone?: ToastTone) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const show = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = Date.now() + Math.random()
    setToasts((current) => [...current, { id, message, tone }])
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), TOAST_DURATION_MS)
  }, [])

  const api = useMemo(() => ({ show }), [show])
  const layerRef = useRef<HTMLDivElement>(null)

  // Camada superior do browser (popover): o aviso fica por cima das folhas de formulário (<dialog> modal) abertas.
  useEffect(() => {
    const layer = layerRef.current
    if (!layer || typeof layer.showPopover !== 'function') return
    if (toasts.length > 0 && !layer.matches(':popover-open')) layer.showPopover()
    if (toasts.length === 0 && layer.matches(':popover-open')) layer.hidePopover()
  }, [toasts.length])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        ref={layerRef}
        popover="manual"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-50 m-0 flex h-auto max-h-none w-full flex-col items-center gap-2 overflow-visible border-0 bg-transparent px-4 py-0"
      >
        {toasts.map((toast) => {
          const Icon = toast.tone === 'success' ? CircleCheck : CircleAlert
          return (
            <div
              key={toast.id}
              role="status"
              className="pointer-events-auto flex w-full max-w-sm animate-toast-in items-center gap-2.5 rounded-full bg-foreground px-4 py-3 text-sm text-white shadow-overlay"
            >
              <Icon
                className={cn('size-5 shrink-0', toast.tone === 'success' ? 'text-success-soft' : 'text-danger-soft')}
                aria-hidden
              />
              {toast.message}
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast tem de ser usado dentro de <ToastProvider>')
  return context
}
