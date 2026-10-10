import { AppError } from '@/lib/errors'
import type { AlertItem, HealthAlert } from '@/types/alert'
import { memberName, requireSelf } from '../access'
import { scanAlerts, type MockAlert } from '../alertRules'
import { expireRequests } from '../bookings'
import { db } from '../db'
import { respond } from '../respond'

/** Resumo, data e recurso da origem (medicamento, consulta ou exame). */
function source(alert: HealthAlert): Pick<AlertItem, 'sourceLabel' | 'sourceAt' | 'targetId'> {
  switch (alert.sourceType) {
    case 'DOSE': {
      const dose = db.doses.find((d) => d.id === alert.sourceId)
      const plan = db.medicationPlans.find((p) => p.id === dose?.planId)
      return { sourceLabel: plan ? `${plan.name} ${plan.dosage}` : '', sourceAt: dose?.scheduledAt, targetId: plan?.id }
    }
    case 'APPOINTMENT': {
      const appointment = db.appointments.find((a) => a.id === alert.sourceId)
      return {
        sourceLabel: appointment?.specialty ?? appointment?.clinicName ?? '',
        sourceAt: appointment?.scheduledAt,
        targetId: appointment?.id,
      }
    }
    case 'EXAMINATION': {
      const examination = db.examinations.find((e) => e.id === alert.sourceId)
      return { sourceLabel: examination?.name ?? '', sourceAt: examination?.examDate, targetId: examination?.id }
    }
  }
}

/** O destinatário e a chave ficam no servidor; a UI recebe o nome do membro e a origem. */
function toItem({ recipientUserId: _recipient, dedupeKey: _key, ...alert }: MockAlert): AlertItem {
  return { ...alert, memberName: memberName(alert.memberId), ...source(alert) }
}

/** Alertas de que o utilizador é destinatário (UC-ALR-03), já disparados. */
function ownAlerts(familyId: string, userId: string, now: Date): MockAlert[] {
  requireSelf(familyId, userId)
  expireRequests(now)
  scanAlerts(db, now)
  return db.alerts.filter(
    (a) => a.familyId === familyId && a.recipientUserId === userId && Date.parse(a.triggerAt) <= now.getTime(),
  )
}

const newestFirst = (a: MockAlert, b: MockAlert) => b.triggerAt.localeCompare(a.triggerAt)

/** Alertas mais recentes primeiro, lidos e por ler (Home). */
export function findAlerts(familyId: string, userId: string, now: Date = new Date()): AlertItem[] {
  return ownAlerts(familyId, userId, now).sort(newestFirst).map(toItem)
}

/** Centro de alertas: não lidos primeiro, depois por data (UC-ALR-03). */
export function listAlerts(familyId: string, userId: string, now: Date = new Date()) {
  return respond(() =>
    ownAlerts(familyId, userId, now)
      .sort((a, b) => Number(Boolean(a.readAt)) - Number(Boolean(b.readAt)) || newestFirst(a, b))
      .map(toItem),
  )
}

export function countUnread(familyId: string, userId: string, now: Date = new Date()) {
  return respond(() => ownAlerts(familyId, userId, now).filter((a) => !a.readAt).length)
}

/** Marcar um alerta como lido (UC-ALR-04). Só o destinatário; os outros recebem NOT_FOUND. */
export function markAlertRead(familyId: string, userId: string, alertId: string, now: Date = new Date()) {
  return respond(() => {
    const alert = ownAlerts(familyId, userId, now).find((a) => a.id === alertId)
    if (!alert) throw new AppError('NOT_FOUND')
    alert.readAt ??= now.toISOString()
  })
}

/** Marcar todos como lidos. */
export function markAllAlertsRead(familyId: string, userId: string, now: Date = new Date()) {
  return respond(() => {
    for (const alert of ownAlerts(familyId, userId, now)) alert.readAt ??= now.toISOString()
  })
}
