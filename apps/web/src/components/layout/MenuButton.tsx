import { useContext, useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/cn'
import { paths } from '@/routes/paths'
import { NavDrawer } from './NavDrawer'
import { UnreadAlertsContext } from './UnreadAlertsContext'

interface MenuButtonProps {
  /** Na Home o menu abre pelo avatar (como na referência visual). */
  variant?: 'icon' | 'avatar'
}

/**
 * Abre o menu de navegação no mobile/tablet. No desktop a sidebar trata da navegação:
 * o ícone esconde-se e o avatar passa a ligar ao perfil de saúde.
 */
export function MenuButton({ variant = 'icon' }: MenuButtonProps) {
  const [open, setOpen] = useState(false)
  const { user, member } = useAuth()
  const unread = useContext(UnreadAlertsContext)
  const name = member?.name ?? user?.name ?? ''
  const label = unread > 0 ? `Abrir menu, ${unread} alertas por ler` : 'Abrir menu'
  const dot = unread > 0 && <span className="absolute top-1 right-1 size-2.5 rounded-full bg-danger ring-2 ring-brand" />

  return (
    <>
      {variant === 'avatar' ? (
        <>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={label}
            className="relative shrink-0 rounded-full ring-2 ring-white/70 lg:hidden"
          >
            <Avatar name={name} size="md" className="bg-white" />
            {dot}
          </button>
          <Link
            to={paths.healthProfile}
            aria-label="O meu perfil de saúde"
            className="hidden shrink-0 rounded-full ring-2 ring-white/70 lg:inline-flex"
          >
            <Avatar name={name} size="md" className="bg-white" />
          </Link>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={label}
          className={cn(
            'relative -mr-2 flex size-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/15 lg:hidden',
          )}
        >
          <Menu className="size-6" aria-hidden />
          {dot}
        </button>
      )}
      <NavDrawer open={open} onClose={() => setOpen(false)} />
    </>
  )
}
