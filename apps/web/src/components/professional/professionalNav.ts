import { CalendarCheck, CalendarClock, ClipboardCheck, FileBadge, MessageCircle, Star, Tags, UserRound, type LucideIcon } from 'lucide-react'
import { paths } from '@/routes/paths'

export interface ProfessionalNavItem {
  to: string
  label: string
  icon: LucideIcon
  end: boolean
}

/** Navegação do portal do profissional (UC-MKT-03..12): áreas de MK1 a MK3 (marcações e avaliações). */
export const professionalNavItems: ProfessionalNavItem[] = [
  { to: paths.professional, label: 'Estado', icon: ClipboardCheck, end: true },
  { to: paths.professionalProfile, label: 'Perfil', icon: UserRound, end: false },
  { to: paths.professionalCredentials, label: 'Credenciais', icon: FileBadge, end: false },
  { to: paths.professionalOffers, label: 'Serviços e preços', icon: Tags, end: false },
  { to: paths.professionalSchedule, label: 'Horários', icon: CalendarClock, end: false },
  { to: paths.professionalBookings, label: 'Marcações', icon: CalendarCheck, end: false },
  { to: paths.professionalConversations, label: 'Conversas', icon: MessageCircle, end: false },
  { to: paths.professionalReviews, label: 'Avaliações', icon: Star, end: false },
]
