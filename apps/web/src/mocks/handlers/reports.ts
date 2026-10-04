import { todayISO } from '@/lib/date'
import type { PendingItem } from '@/types/report'
import { db } from '../db'

/** TBD (Q11): janela das tomas “não confirmadas recentes” consideradas pendentes. */
export const RECENT_UNCONFIRMED_DAYS = 7

const DAY_MS = 86_400_000

/**
 * Itens pendentes por membro (UC-RPT-02): tomas não confirmadas recentes,
 * consultas agendadas já passadas e exames agendados já passados. Só contagens, sem juízo clínico.
 */
export function pendingItems(familyId: string, memberIds: string[], now: Date = new Date()): PendingItem[] {
  const ids = new Set(memberIds)
  const inScope = (item: { familyId: string; memberId: string }) => item.familyId === familyId && ids.has(item.memberId)
  const since = now.getTime() - RECENT_UNCONFIRMED_DAYS * DAY_MS
  const today = todayISO(now)

  const doses = db.doses
    .filter((d) => inScope(d) && d.status === 'UNCONFIRMED' && Date.parse(d.scheduledAt) >= since)
    .map((d): PendingItem => ({ kind: 'DOSE_UNCONFIRMED', memberId: d.memberId, sourceId: d.id }))

  const appointments = db.appointments
    .filter((a) => inScope(a) && a.status === 'SCHEDULED' && Date.parse(a.scheduledAt) < now.getTime())
    .map((a): PendingItem => ({ kind: 'APPOINTMENT_OVERDUE', memberId: a.memberId, sourceId: a.id }))

  const exams = db.examinations
    .filter((e) => inScope(e) && e.status === 'SCHEDULED' && e.examDate < today)
    .map((e): PendingItem => ({ kind: 'EXAM_OVERDUE', memberId: e.memberId, sourceId: e.id }))

  return [...doses, ...appointments, ...exams]
}
