import { CalendarDays, CalendarClock, FlaskConical, Inbox, LayoutDashboard, Users, type LucideIcon } from 'lucide-react'
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

export interface ClinicNavGroup {
  /** Título da secção na barra lateral; ausente = item solto no topo. */
  title?: string
  items: ClinicNavItem[]
}

/**
 * Navegação do portal da clínica (docs/11-implementation/clinic-portal-v2.md), partilhada pela
 * barra lateral (desktop) e pelos separadores (telemóvel). Só entram áreas que já existem:
 * as das fases seguintes (pacientes, serviços, financeiro…) aparecem quando forem entregues.
 */
export const clinicNavGroups: ClinicNavGroup[] = [
  { items: [{ to: paths.clinic, label: 'Hoje', icon: LayoutDashboard, end: true }] },
  {
    title: 'Agenda',
    items: [
      { to: paths.clinicRequests, label: 'Pedidos', icon: Inbox, end: false, pending: true },
      { to: paths.clinicAgenda, label: 'Calendário', icon: CalendarDays, end: false },
      { to: paths.clinicSlots, label: 'Horários', icon: CalendarClock, end: false },
    ],
  },
  { title: 'Exames', items: [{ to: paths.clinicExams, label: 'Exames', icon: FlaskConical, end: false }] },
  { title: 'Gestão', items: [{ to: paths.clinicStaff, label: 'Contas', icon: Users, end: false, adminOnly: true }] },
]

/** Lista plana (separadores do telemóvel). */
export const clinicNav: ClinicNavItem[] = clinicNavGroups.flatMap((group) => group.items)
