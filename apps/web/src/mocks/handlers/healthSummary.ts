import { todayISO } from '@/lib/date'
import { AppError } from '@/lib/errors'
import type {
  AdherenceBucket,
  CountByMonth,
  ExamParameterSeries,
  FamilyHealthSummary,
  FamilyHealthSummaryMember,
  HealthSummary,
  MedicationAdherenceStat,
  MissingRecordItem,
} from '@/types/healthSummary'
import type { SharingCategory } from '@/types/sharing'
import { expireRequests } from '../bookings'
import { db } from '../db'
import { respond } from '../respond'
import { findAlerts } from './alerts'
import { reportSubjects, resolvePeriod } from './reports'

/*
 * Resumo de saúde (M17, BR-RPT-11..17): cálculo determinístico, sem IA e sem juízo clínico.
 * Os números são feitos aqui (no servidor simulado); o ecrã só os apresenta.
 */

const DAY_MS = 86_400_000
/** BR-RPT-15: «a terminar» = 14 dias; «próximos» = 30 dias (OP-143). */
export const ENDING_SOON_DAYS = 14
export const UPCOMING_DAYS = 30
/** BR-RPT-14: máximo de séries e de pontos por série. */
export const MAX_SERIES = 20
export const MAX_POINTS = 100
/** BR-RPT-12: séries semanais até 90 dias, mensais acima. */
export const WEEKLY_MAX_DAYS = 90

const dayNumber = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS)
const addDays = (iso: string, days: number) => new Date((dayNumber(iso) + days) * DAY_MS).toISOString().slice(0, 10)

const pct = (taken: number, denominator: number) => (denominator === 0 ? null : Math.round((100 * taken) / denominator))

/** Segunda-feira da semana de `iso`. */
function weekStart(iso: string): string {
  const weekday = (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7
  return addDays(iso, -weekday)
}

function bucket(periodStart: string, counts: { taken: number; notTaken: number; unconfirmed: number }): AdherenceBucket {
  return { periodStart, ...counts, adherencePct: pct(counts.taken, counts.taken + counts.notTaken + counts.unconfirmed) }
}

const ofMember = (familyId: string, memberId: string) => (item: { familyId: string; memberId: string }) =>
  item.familyId === familyId && item.memberId === memberId

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1
  return out
}

function byMonth(dates: string[]): CountByMonth[] {
  const counts = countBy(dates, (d) => d.slice(0, 7))
  return Object.keys(counts)
    .sort()
    .map((month) => ({ month, count: counts[month] ?? 0 }))
}

type Subject = ReturnType<typeof reportSubjects>[number]

/** Cálculo do resumo de um membro já autorizado. */
function summarizeMember(familyId: string, userId: string, subject: Subject, period: { from: string; to: string }, now: Date): HealthSummary {
  const { member, manage, categories } = subject
  const { from, to } = period
  const owned = ofMember(familyId, member.id)
  const can = (category: SharingCategory) => categories.has(category)
  const today = todayISO(now)
  const inPeriod = (date: string) => date.slice(0, 10) >= from && date.slice(0, 10) <= to
  const horizon = (days: number) => todayISO(new Date(now.getTime() + days * DAY_MS))
  const upcoming = (date: string, days: number) => date.slice(0, 10) >= today && date.slice(0, 10) <= horizon(days)
  const result: HealthSummary = { memberId: member.id, period, generatedAt: now.toISOString() }
  const missing: MissingRecordItem[] = []
  const addMissing = (code: MissingRecordItem['code'], ids: string[], writable: boolean) => {
    if (ids.length > 0) missing.push({ code, count: ids.length, ...(manage && writable ? { sourceIds: ids.slice(0, 20) } : {}) })
  }

  const plans = db.medicationPlans.filter(owned)
  if (can('MEDICATION')) {
    // Só as tomas já passadas entram no cálculo; as futuras ficam em `pending` (BR-RPT-13).
    const doses = db.doses.filter(
      (d) => owned(d) && Date.parse(d.scheduledAt) <= now.getTime() && inPeriod(d.scheduledAt),
    )
    const stat = (list: typeof doses) => ({
      taken: list.filter((d) => d.status === 'TAKEN').length,
      notTaken: list.filter((d) => d.status === 'NOT_TAKEN').length,
      unconfirmed: list.filter((d) => d.status === 'UNCONFIRMED' || d.status === 'PENDING').length,
    })
    const futureByPlan = (planId: string) =>
      db.doses.filter((d) => d.planId === planId && Date.parse(d.scheduledAt) > now.getTime() && inPeriod(d.scheduledAt)).length
    const byMedication = plans
      .map((plan): MedicationAdherenceStat => {
        const counts = stat(doses.filter((d) => d.planId === plan.id))
        return {
          planId: plan.id,
          medicationName: `${plan.name} ${plan.dosage}`,
          ...counts,
          pending: futureByPlan(plan.id),
          adherencePct: pct(counts.taken, counts.taken + counts.notTaken + counts.unconfirmed),
        }
      })
      .filter((m) => m.taken + m.notTaken + m.unconfirmed + m.pending > 0)

    const spanDays = dayNumber(to) - dayNumber(from) + 1
    const granularity = spanDays <= WEEKLY_MAX_DAYS ? 'WEEK' : 'MONTH'
    const startOf = (date: string) => (granularity === 'WEEK' ? weekStart(date) : `${date.slice(0, 7)}-01`)
    const keys = [...new Set(doses.map((d) => startOf(d.scheduledAt.slice(0, 10))))].sort()
    result.medication = {
      overall: bucket(from, stat(doses)),
      byMedication,
      granularity,
      series: keys.map((key) => bucket(key, stat(doses.filter((d) => startOf(d.scheduledAt.slice(0, 10)) === key)))),
    }

    const ownPrescriptions = db.prescriptions.filter(owned)
    const endOf = (id: string) =>
      plans
        .filter((p) => p.prescriptionId === id)
        .map((p) => (p.endedAt ?? p.endAt ?? '').slice(0, 10))
        .filter(Boolean)
        .sort()
        .pop()
    const active = ownPrescriptions.filter((p) => p.status === 'ACTIVE')
    result.prescriptions = {
      active: active.length,
      endingSoon: active.filter((p) => {
        const end = endOf(p.id)
        return end !== undefined && end >= today && end <= horizon(ENDING_SOON_DAYS)
      }).length,
      closedInPeriod: ownPrescriptions.filter((p) => p.status !== 'ACTIVE' && inPeriod(endOf(p.id) ?? p.issuedOn)).length,
    }

    addMissing(
      'PRESCRIPTION_WITHOUT_DOCUMENT',
      active.filter((p) => !db.documents.some((d) => d.resourceType === 'PRESCRIPTION' && d.resourceId === p.id)).map((p) => p.id),
      true,
    )
    addMissing(
      'PLAN_WITHOUT_SCHEDULE',
      plans.filter((p) => p.status === 'ACTIVE' && p.scheduleType === 'FIXED_TIMES' && !(p.times?.length)).map((p) => p.id),
      true,
    )
    const unconfirmed = db.doses.filter((d) => owned(d) && d.status === 'UNCONFIRMED' && Date.parse(d.scheduledAt) <= now.getTime())
    addMissing('DOSES_UNCONFIRMED', unconfirmed.map((d) => d.id), true)
  }

  if (can('EXAMS')) {
    const exams = db.examinations.filter(owned)
    const inRange = exams.filter((e) => inPeriod(e.examDate))
    const ids = new Set(inRange.map((e) => e.id))
    type Point = { date: string; value: number }
    const groups = new Map<string, { parameter: string; unit: string; points: Point[]; reference: (typeof db.examResults)[number] | null }>()
    for (const r of db.examResults.filter((x) => ids.has(x.examinationId) && typeof x.valueNumeric === 'number')) {
      const exam = inRange.find((e) => e.id === r.examinationId)
      if (!exam) continue
      const unit = (r.unit ?? '').trim()
      const key = `${r.parameter.trim().toLowerCase()}|${unit}`
      const group = groups.get(key) ?? { parameter: r.parameter.trim(), unit, points: [], reference: null }
      group.points.push({ date: exam.examDate.slice(0, 10), value: r.valueNumeric as number })
      group.reference = r
      groups.set(key, group)
    }
    const series = [...groups.values()]
      .map((g): ExamParameterSeries => {
        const points = g.points.sort((a, b) => a.date.localeCompare(b.date))
        const values = points.map((p) => p.value)
        const first = values[0] ?? 0
        const last = values[values.length - 1] ?? 0
        return {
          parameter: g.parameter,
          unit: g.unit,
          count: values.length,
          min: Math.min(...values),
          max: Math.max(...values),
          first,
          last,
          variationAbs: values.length < 2 ? null : Math.round((last - first) * 100) / 100,
          variationPct: values.length < 2 || first === 0 ? null : Math.round(((last - first) / Math.abs(first)) * 1000) / 10,
          referenceMin: g.reference?.referenceMin ?? null,
          referenceMax: g.reference?.referenceMax ?? null,
          referenceText: null,
          points: points.slice(-MAX_POINTS),
          truncated: points.length > MAX_POINTS,
        }
      })
      .sort((a, b) => (b.points.at(-1)?.date ?? '').localeCompare(a.points.at(-1)?.date ?? '') || a.parameter.localeCompare(b.parameter))
    result.exams = {
      byStatus: countBy(inRange, (e) => e.status),
      byMonth: byMonth(inRange.map((e) => e.examDate)),
      upcoming30d: exams.filter((e) => e.status === 'SCHEDULED' && upcoming(e.examDate, UPCOMING_DAYS)).length,
      series: series.slice(0, MAX_SERIES),
      truncated: series.length > MAX_SERIES,
    }
    addMissing('EXAM_PAST_OPEN', exams.filter((e) => e.status === 'SCHEDULED' && e.examDate.slice(0, 10) < today).map((e) => e.id), true)
    addMissing(
      'EXAM_WITHOUT_RESULTS',
      exams
        .filter(
          (e) =>
            e.status === 'COMPLETED' &&
            !db.examResults.some((r) => r.examinationId === e.id) &&
            !db.documents.some((d) => d.resourceType === 'EXAMINATION' && d.resourceId === e.id),
        )
        .map((e) => e.id),
      true,
    )
  }

  if (can('APPOINTMENTS')) {
    const list = db.appointments.filter(owned)
    const inRange = list.filter((a) => inPeriod(a.scheduledAt))
    result.appointments = {
      byStatus: countBy(inRange, (a) => a.status),
      byMonth: byMonth(inRange.map((a) => a.scheduledAt)),
      upcoming30d: list.filter((a) => a.status === 'SCHEDULED' && Date.parse(a.scheduledAt) > now.getTime() && upcoming(a.scheduledAt, UPCOMING_DAYS)).length,
    }
    addMissing('APPOINTMENT_PAST_OPEN', list.filter((a) => a.status === 'SCHEDULED' && Date.parse(a.scheduledAt) < now.getTime()).map((a) => a.id), true)
  }

  // Alertas do membro dirigidos ao pedinte (só contagens, nunca o texto).
  const alerts = findAlerts(familyId, userId, now).filter((a) => a.memberId === member.id && inPeriod(a.triggerAt))
  result.alerts = { total: alerts.length, unread: alerts.filter((a) => !a.readAt).length, byType: countBy(alerts, (a) => a.type) }

  if (can('ALLERGIES') && (!member.bloodType || member.bloodType === 'UNKNOWN')) missing.push({ code: 'BLOOD_TYPE_UNSET', count: 1 })
  result.missing = missing
  return result
}

/** Resumo de saúde de um membro (UC-RPT-05). Sem permissão ou outra família → NOT_FOUND. */
export function getMemberHealthSummary(
  familyId: string,
  userId: string,
  memberId: string,
  period: { from?: string; to?: string } = {},
  now: Date = new Date(),
) {
  return respond((): HealthSummary => {
    const subject = reportSubjects(familyId, userId).find((s) => s.member.id === memberId)
    if (!subject) throw new AppError('NOT_FOUND')
    expireRequests(now)
    return summarizeMember(familyId, userId, subject, resolvePeriod(period, now), now)
  })
}

/** Resumo de saúde da família (UC-RPT-05b): um bloco por membro visível, com a atividade. */
export function getFamilyHealthSummary(
  familyId: string,
  userId: string,
  period: { from?: string; to?: string } = {},
  now: Date = new Date(),
) {
  return respond((): FamilyHealthSummary => {
    const resolved = resolvePeriod(period, now)
    expireRequests(now)
    const subjects = reportSubjects(familyId, userId)
    const members = subjects.map((subject): FamilyHealthSummaryMember => {
      const { member, categories } = subject
      const summary = summarizeMember(familyId, userId, subject, resolved, now)
      const owned = ofMember(familyId, member.id)
      const inPeriod = (date: string) => date.slice(0, 10) >= resolved.from && date.slice(0, 10) <= resolved.to
      const dates: string[] = []
      const activity: NonNullable<FamilyHealthSummaryMember['activity']> = {}
      if (categories.has('MEDICATION')) {
        const rx = db.prescriptions.filter((p) => owned(p) && inPeriod(p.issuedOn))
        const taken = db.doses.filter((d) => owned(d) && d.status === 'TAKEN' && inPeriod(d.scheduledAt))
        activity.prescriptions = rx.length
        activity.dosesConfirmed = taken.length
        dates.push(...rx.map((p) => p.issuedOn.slice(0, 10)), ...taken.map((d) => d.scheduledAt.slice(0, 10)))
      }
      if (categories.has('APPOINTMENTS')) {
        const list = db.appointments.filter((a) => owned(a) && inPeriod(a.scheduledAt))
        activity.appointments = list.length
        dates.push(...list.map((a) => a.scheduledAt.slice(0, 10)))
      }
      if (categories.has('EXAMS')) {
        const list = db.examinations.filter((e) => owned(e) && inPeriod(e.examDate))
        activity.exams = list.length
        dates.push(...list.map((e) => e.examDate.slice(0, 10)))
      }
      activity.lastActivityOn = dates.filter((d) => d <= todayISO(now)).sort().pop() ?? null
      return {
        memberId: member.id,
        displayName: member.name,
        ...(summary.medication ? { adherencePct: summary.medication.overall.adherencePct, activeMedications: plansActive(familyId, member.id) } : {}),
        upcoming30d: (summary.appointments?.upcoming30d ?? 0) + (summary.exams?.upcoming30d ?? 0),
        missingCount: (summary.missing ?? []).reduce((total, item) => total + item.count, 0),
        activity,
      }
    })
    return { period: resolved, generatedAt: now.toISOString(), members }
  })
}

const plansActive = (familyId: string, memberId: string) =>
  db.medicationPlans.filter((p) => p.familyId === familyId && p.memberId === memberId && p.status === 'ACTIVE').length
