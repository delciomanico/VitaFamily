import type { AlertItem, HealthAlert } from '@/types/alert'
import type { MockAlert } from '../data/alerts'
import { memberName, requireSelf } from '../access'
import { db } from '../db'
import { respond } from '../respond'

/** Resumo da origem do alerta (nome do medicamento, especialidade ou exame). */
function sourceLabel(alert: HealthAlert): string {
  switch (alert.sourceType) {
    case 'DOSE': {
      const dose = db.doses.find((d) => d.id === alert.sourceId)
      const plan = db.medicationPlans.find((p) => p.id === dose?.planId)
      return plan ? `${plan.name} ${plan.dosage}` : ''
    }
    case 'APPOINTMENT': {
      const appointment = db.appointments.find((a) => a.id === alert.sourceId)
      return appointment?.specialty ?? appointment?.clinicName ?? ''
    }
    case 'EXAMINATION':
      return db.examinations.find((e) => e.id === alert.sourceId)?.name ?? ''
  }
}

/** O destinatário fica no servidor; a UI recebe o alerta com nome do membro e resumo da origem. */
function toItem({ recipientUserId: _recipient, ...alert }: MockAlert): AlertItem {
  return { ...alert, memberName: memberName(alert.memberId), sourceLabel: sourceLabel(alert) }
}

/** Alertas do utilizador já disparados, mais recentes primeiro. */
export function findAlerts(familyId: string, userId: string, now: Date = new Date()): AlertItem[] {
  requireSelf(familyId, userId)
  return db.alerts
    .filter((a) => a.familyId === familyId && a.recipientUserId === userId && Date.parse(a.triggerAt) <= now.getTime())
    .sort((a, b) => b.triggerAt.localeCompare(a.triggerAt))
    .map(toItem)
}

export function listAlerts(familyId: string, userId: string) {
  return respond(() => findAlerts(familyId, userId))
}

export function countUnread(familyId: string, userId: string) {
  return respond(() => findAlerts(familyId, userId).filter((a) => !a.readAt).length)
}
