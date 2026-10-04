import { useContext, useState } from 'react'
import { EllipsisVertical } from 'lucide-react'
import { NavDrawer } from './NavDrawer'
import { UnreadAlertsContext } from './UnreadAlertsContext'

/**
 * Botão de menu (três pontos) da faixa: abre a navegação no mobile/tablet.
 * No desktop a sidebar trata da navegação e o botão esconde-se.
 */
export function MenuButton() {
  const [open, setOpen] = useState(false)
  const unread = useContext(UnreadAlertsContext)
  const label = unread > 0 ? `Abrir menu, ${unread} alertas por ler` : 'Abrir menu'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        className="relative -mr-2 flex size-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/15 lg:hidden"
      >
        <EllipsisVertical className="size-6" aria-hidden />
        {unread > 0 && <span className="absolute top-2 right-2.5 size-2.5 rounded-full bg-danger ring-2 ring-brand" />}
      </button>
      <NavDrawer open={open} onClose={() => setOpen(false)} />
    </>
  )
}
