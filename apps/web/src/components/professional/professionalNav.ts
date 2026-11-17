import { CalendarClock, ClipboardCheck, FileBadge, Tags, UserRound, type LucideIcon } from 'lucide-react'
import { paths } from '@/routes/paths'

export interface ProfessionalNavItem {
  to: string
  label: string
  icon: LucideIcon
  end: boolean
}

/** Navegação do portal do profissional (UC-MKT-03..12): só áreas que existem em MK1. */
export const professionalNavItems: ProfessionalNavItem[] = [
  { to: paths.professional, label: 'Estado', icon: ClipboardCheck, end: true },
  { to: paths.professionalProfile, label: 'Perfil', icon: UserRound, end: false },
  { to: paths.professionalCredentials, label: 'Credenciais', icon: FileBadge, end: false },
  { to: paths.professionalOffers, label: 'Serviços e preços', icon: Tags, end: false },
  { to: paths.professionalSchedule, label: 'Horários', icon: CalendarClock, end: false },
]
