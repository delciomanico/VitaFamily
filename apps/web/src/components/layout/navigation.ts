import { CalendarDays, HeartPulse, House, Settings, Users, type LucideIcon } from 'lucide-react'
import { paths } from '@/routes/paths'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Ativo só na rota exata (a Home é prefixo de todas as outras). */
  end?: boolean
}

/** Navegação principal: bottom nav (mobile) e sidebar (desktop). */
export const primaryNav: NavItem[] = [
  { to: paths.home, label: 'Início', icon: House, end: true },
  { to: paths.health, label: 'Saúde', icon: HeartPulse },
  { to: paths.appointments, label: 'Agenda', icon: CalendarDays },
  { to: paths.family, label: 'Família', icon: Users },
]

export const settingsNav: NavItem = { to: paths.settings, label: 'Configurações', icon: Settings }
