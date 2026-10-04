import { todayISO } from '@/lib/date'
import type { HomeSummary, TodayDose } from '@/types/report'
import { memberName, requireSelf, visibleMemberIds } from '../access'
import { db } from '../db'
import { respond } from '../respond'
import { findAlerts } from './alerts'
import { pendingItems } from './reports'

/** TBD: durante quantos dias um resultado de exame conta como “novo” na Home. */
export const NEW_RESULT_DAYS = 7

/** Número máximo de alertas recentes enviados para a Home (a UI mostra os que couberem). */
export const HOME_ALERTS_LIMIT = 8

const DAY_MS = 86_400_000

/** Resumo da Home: o que tenho hoje, como está a família e o que precisa de atenção. */
export function getHomeSummary(familyId: string, userId: string, now: Date = new Date()) {
  return respond((): HomeSummary => {
    const self = requireSelf(familyId, userId)
    const visible = new Set(visibleMemberIds(familyId, userId))
    const inScope = (item: { familyId: string; memberId: string }) => item.familyId === familyId && visible.has(item.memberId)

    const next = db.appointments
      .filter((a) => inScope(a) && a.status === 'SCHEDULED' && Date.parse(a.scheduledAt) > now.getTime())
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0]

    const today = todayISO(now)
    const dosesToday = db.doses
      .filter((d) => inScope(d) && todayISO(new Date(d.scheduledAt)) === today)
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    const pendingDoses = dosesToday.filter((d) => d.status === 'PENDING').length
    const todayDoses = dosesToday.map((d): TodayDose => {
      const plan = db.medicationPlans.find((p) => p.id === d.planId)
      return {
        id: d.id,
        scheduledAt: d.scheduledAt,
        status: d.status,
        medication: plan ? `${plan.name} ${plan.dosage}` : '',
        memberName: memberName(d.memberId),
        isSelf: d.memberId === self.id,
      }
    })

    const visibleExams = new Set(db.examinations.filter(inScope).map((e) => e.id))
    const newSince = now.getTime() - NEW_RESULT_DAYS * DAY_MS
    const newResults = db.examResults.filter(
      (r) => visibleExams.has(r.examinationId) && Date.parse(r.createdAt) >= newSince,
    ).length

    const pendingMembers = new Set(pendingItems(familyId, [...visible], now).map((p) => p.memberId))
    const familyMembers = db.members.filter((m) => m.familyId === familyId && m.status === 'ACTIVE').length

    return {
      nextAppointment: next
        ? { appointment: next, memberName: memberName(next.memberId), isSelf: next.memberId === self.id }
        : null,
      today: { pendingDoses, newResults, members: familyMembers },
      family: { tracked: visible.size, withPending: pendingMembers.size },
      recentAlerts: findAlerts(familyId, userId, now).slice(0, HOME_ALERTS_LIMIT),
      todayDoses,
    }
  })
}
