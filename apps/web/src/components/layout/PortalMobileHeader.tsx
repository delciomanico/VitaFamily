import { useEffect, useRef, useState } from 'react'
import { LogOut, Menu, X } from 'lucide-react'
import { LogoMark } from './Logo'
import { bandTitleClass } from './Page'
import { PortalNavList, type PortalNavGroup } from './PortalSidebar'

interface PortalMobileHeaderProps {
  ariaLabel: string
  title: string
  subtitle?: string
  email?: string | null
  groups: PortalNavGroup[]
  onSignOut: () => void
}

/**
 * Faixa do telemóvel/tablet (<lg) dos portais: identidade e botão de menu que abre a mesma
 * navegação agrupada da barra lateral num painel (<dialog>: foco preso, Esc fecha), em vez de
 * separadores com scroll horizontal. O contador total aparece no botão para não se perder pedidos.
 */
export function PortalMobileHeader({ ariaLabel, title, subtitle, email, groups, onSignOut }: PortalMobileHeaderProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDialogElement>(null)
  const totalBadge = groups.reduce((sum, g) => sum + g.items.reduce((s, i) => s + (i.badge ?? 0), 0), 0)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const close = () => setOpen(false)

  return (
    <>
      <header className="bg-brand pt-safe text-white lg:hidden">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <LogoMark tone="inverse" className="size-8 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className={bandTitleClass}>{title}</p>
            {subtitle && <p className="truncate text-xs text-white/80">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={totalBadge > 0 ? `Abrir menu, ${totalBadge} por responder` : 'Abrir menu'}
            className="relative -mr-2 flex size-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/15"
          >
            <Menu className="size-5" aria-hidden />
            {totalBadge > 0 && <span className="absolute top-2 right-2.5 size-2.5 rounded-full bg-danger ring-2 ring-brand" />}
          </button>
        </div>
      </header>
      <dialog
        ref={ref}
        onClose={close}
        onClick={(event) => event.target === ref.current && close()}
        aria-label="Menu"
        className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-[min(20rem,85vw)] max-w-none bg-surface p-0 text-foreground shadow-overlay"
      >
        <div className="flex h-full flex-col gap-4 px-4 pt-[max(1rem,var(--safe-top))] pb-[max(1rem,var(--safe-bottom))]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold">{title}</p>
              {email && <p className="truncate text-sm text-muted">{email}</p>}
            </div>
            <button
              type="button"
              onClick={close}
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-muted"
              aria-label="Fechar menu"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <PortalNavList ariaLabel={ariaLabel} groups={groups} onNavigate={close} className="flex-1 overflow-y-auto" />
          <button
            type="button"
            onClick={() => {
              close()
              onSignOut()
            }}
            className="flex h-12 items-center gap-3 rounded-full px-4 text-sm font-medium text-muted hover:bg-surface-muted hover:text-foreground"
          >
            <LogOut className="size-5" aria-hidden />
            Sair
          </button>
        </div>
      </dialog>
    </>
  )
}
