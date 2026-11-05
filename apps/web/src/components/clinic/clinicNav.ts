import { CalendarDays, CalendarClock, FlaskConical, Inbox, Users, type LucideIcon } from 'lucide-react'
import { paths } from '@/routes/paths'

export interface ClinicNavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Só o Admin da clínica (BR-CLN-05). */
  adminOnly?: boolean
  /** Correspondência exata (a raiz `/clinic` não pode ficar ativa nas filhas). */
  end: boolean
  /** Mostra o contador de pedidos por responder. */
  pending?: boolean
}

/** Navegação do portal da clínica, partilhada pela barra lateral (desktop) e pelos separadores (telemóvel). */
export const clinicNav: ClinicNavItem[] = [
  { to: paths.clinic, label: 'Pedidos', icon: Inbox, end: true, pending: true },
  { to: paths.clinicAgenda, label: 'Agenda', icon: CalendarDays, end: false },
  { to: paths.clinicExams, label: 'Exames', icon: FlaskConical, end: false },
  { to: paths.clinicSlots, label: 'Horários', icon: CalendarClock, end: false },
  { to: paths.clinicStaff, label: 'Contas', icon: Users, end: false, adminOnly: true },
]
