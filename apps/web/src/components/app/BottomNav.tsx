import { Link, useLocation } from 'react-router-dom'
import { CalendarCheck, House, MessageCircle, UserRound, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { paths } from '@/routes/paths'

type TabId = 'home' | 'bookings' | 'conversations' | 'profile'

/** Separador ativo de uma rota: as áreas do Perfil (serviços, horários…) pertencem ao separador «Perfil». */
export function activeTab(pathname: string, search = ''): TabId {
  if (pathname.startsWith(paths.professionalBookings)) return 'bookings'
  if (pathname.startsWith(paths.professionalShares) && new URLSearchParams(search).has('marcacao')) return 'bookings'
  if (pathname.startsWith(paths.professionalConversations)) return 'conversations'
  if (pathname === paths.professional || pathname === `${paths.professional}/`) return 'home'
  return 'profile'
}

interface BottomNavProps {
  /** Mensagens por ler (aparece no separador «Conversas»). */
  unread?: number
}

interface Tab {
  id: TabId
  to: string
  label: string
  icon: LucideIcon
}

const TABS: Tab[] = [
  { id: 'home', to: paths.professional, label: 'Início', icon: House },
  { id: 'bookings', to: paths.professionalBookings, label: 'Marcações', icon: CalendarCheck },
  { id: 'conversations', to: paths.professionalConversations, label: 'Conversas', icon: MessageCircle },
  { id: 'profile', to: paths.professionalProfile, label: 'Perfil', icon: UserRound },
]

/**
 * Barra inferior fixa (4 separadores, por ordem de importância de acesso). Ícone + texto, alvo ≥ 64 px,
 * separador ativo evidente (pílula + texto a negrito + `aria-current`), respeita a área segura do ecrã.
 */
export function BottomNav({ unread = 0 }: BottomNavProps) {
  const { pathname, search } = useLocation()
  const active = activeTab(pathname, search)
  return (
    <nav aria-label="Principal" className="app-mobile fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-safe shadow-overlay">
      <ul className="mx-auto grid max-w-[34rem] grid-cols-4">
        {TABS.map(({ id, to, label, icon: Icon }) => {
          const isActive = active === id
          return (
            <li key={id}>
              <Link
                to={to}
                aria-current={isActive ? 'page' : undefined}
                aria-label={id === 'conversations' && unread > 0 ? `${label}, ${unread} por ler` : undefined}
                className={cn(
                  'relative flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 py-2 text-sm transition-colors focus-visible:outline-offset-[-3px]',
                  isActive ? 'font-bold text-primary' : 'font-medium text-muted hover:text-foreground',
                )}
              >
                <span className={cn('relative flex h-8 w-14 items-center justify-center rounded-full transition-colors', isActive && 'bg-primary-soft')}>
                  <Icon className="size-6" strokeWidth={isActive ? 2.4 : 2} aria-hidden />
                  {id === 'conversations' && unread > 0 && (
                    <span aria-hidden className="absolute top-0 right-2 flex min-w-5 items-center justify-center rounded-full bg-danger px-1 text-xs leading-5 font-semibold text-white">
                      {unread > 9 ? '9+' : unread}
                    </span>
                  )}
                </span>
                <span>{label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
