import type { Appointment } from './appointment'
import type { AlertItem } from './alert'

/** Itens pendentes de um membro (UC-RPT-02, proposta dos docs). */
export type PendingItemKind = 'DOSE_UNCONFIRMED' | 'APPOINTMENT_OVERDUE' | 'EXAM_OVERDUE'

export interface PendingItem {
  kind: PendingItemKind
  memberId: string
  sourceId: string
}

/** Resumo para a Home. */
export interface HomeSummary {
  nextAppointment: { appointment: Appointment; memberName: string; isSelf: boolean } | null
  today: {
    /** Tomas de hoje ainda por confirmar. */
    pendingDoses: number
    /** Resultados de exame registados recentemente. */
    newResults: number
    members: number
  }
  family: {
    /** Membros visíveis ao utilizador. */
    tracked: number
    /** Membros com pelo menos um item pendente. */
    withPending: number
  }
  unreadAlerts: AlertItem[]
}
