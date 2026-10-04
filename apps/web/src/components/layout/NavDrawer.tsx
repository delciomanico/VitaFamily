import { useContext, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { LogOut, X } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { useAuth } from '@/contexts/AuthContext'
import { paths } from '@/routes/paths'
import { NavLinkItem } from './NavLinkItem'
import { UnreadAlertsContext } from './UnreadAlertsContext'
import { alertsNav, primaryNav, settingsNav } from './navigation'

interface NavDrawerProps {
  open: boolean
  onClose: () => void
}

/** Menu lateral do mobile (<dialog>: foco preso, Esc fecha). */
export function NavDrawer({ open, onClose }: NavDrawerProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const { user, family, member, logout } = useAuth()
  const unread = useContext(UnreadAlertsContext)
  const name = member?.name ?? user?.name ?? ''

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
      aria-label="Menu"
      className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-[min(20rem,85vw)] max-w-none bg-surface p-0 text-foreground shadow-overlay"
    >
      <div className="flex h-full flex-col gap-4 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex items-start justify-between gap-3">
          <Link to={paths.healthProfile} onClick={onClose} className="flex min-w-0 items-center gap-3 rounded-xl p-1">
            <Avatar name={name} size="lg" />
            <span className="min-w-0">
              <span className="block truncate font-semibold">{name}</span>
              <span className="block truncate text-sm text-muted">{family?.name}</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-muted"
            aria-label="Fechar menu"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <nav aria-label="Menu principal" className="flex flex-1 flex-col gap-1">
          {primaryNav.map((item) => (
            <NavLinkItem key={item.to} item={item} onNavigate={onClose} />
          ))}
          <NavLinkItem item={alertsNav} count={unread} countLabel="por ler" onNavigate={onClose} />
          <NavLinkItem item={settingsNav} onNavigate={onClose} />
        </nav>

        <button
          type="button"
          onClick={logout}
          className="flex h-12 items-center gap-3 rounded-full px-4 text-sm font-medium text-muted hover:bg-surface-muted hover:text-foreground"
        >
          <LogOut className="size-5" aria-hidden />
          Sair
        </button>
      </div>
    </dialog>
  )
}
