import { isValidISODate, monthsBefore, todayISO } from '@/lib/date'
import { AppError } from '@/lib/errors'
import type { Appointment } from '@/types/appointment'
import type { DoseStatus } from '@/types/medication'
import type {
  AdherenceItem,
  FamilyReport,
  MemberReport,
  PendingItem,
  ReportPeriod,
  ReportSubject,
} from '@/types/report'
import { SHARING_CATEGORIES, type SharingCategory } from '@/types/sharing'
import { memberAccess, requireSelf, visibleMemberIds } from '../access'
import { expireRequests } from '../bookings'
import { db } from '../db'
import { respond } from '../respond'
import { summarize } from './medications'
import { toPublic, upcomingFirst } from './members'

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
    .map((d): PendingItem => {
      const plan = db.medicationPlans.find((p) => p.id === d.planId)
      return {
        type: 'UNCONFIRMED_DOSE',
        memberId: d.memberId,
        sourceId: d.id,
        date: d.scheduledAt,
        label: plan ? `${plan.name} ${plan.dosage}` : '',
        targetId: d.planId,
      }
    })

  const appointments = db.appointments
    .filter((a) => inScope(a) && a.status === 'SCHEDULED' && Date.parse(a.scheduledAt) < now.getTime())
    .map((a): PendingItem => ({
      type: 'APPOINTMENT_OUTCOME',
      memberId: a.memberId,
      sourceId: a.id,
      date: a.scheduledAt,
      label: a.specialty ?? a.reason ?? 'Consulta',
      targetId: a.id,
    }))

  const exams = db.examinations
    .filter((e) => inScope(e) && e.status === 'SCHEDULED' && e.examDate < today)
    .map((e): PendingItem => ({
      type: 'EXAM_OUTCOME',
      memberId: e.memberId,
      sourceId: e.id,
      date: e.examDate,
      label: e.name,
      targetId: e.id,
    }))

  return [...doses, ...appointments, ...exams]
}

/** Categoria de que cada pendente depende (BR-RPT-01). */
const PENDING_CATEGORY: Record<PendingItem['type'], SharingCategory> = {
  UNCONFIRMED_DOSE: 'MEDICATION',
  APPOINTMENT_OUTCOME: 'APPOINTMENTS',
  EXAM_OUTCOME: 'EXAMS',
}

const ofMember = (familyId: string, memberId: string) => (item: { familyId: string; memberId: string }) =>
  item.familyId === familyId && item.memberId === memberId

/** Consultas que contam: pedidas ou agendadas (próximas) e as que aconteceram. */
const REPORTED_APPOINTMENTS: Appointment['status'][] = ['REQUESTED', 'SCHEDULED', 'COMPLETED', 'NO_SHOW']

/** Membros ativos com alguma informação visível ao utilizador: o próprio, os dependentes e quem partilha. */
function reportSubjects(familyId: string, userId: string) {
  const self = requireSelf(familyId, userId)
  const managed = new Set(visibleMemberIds(familyId, userId))
  return db.members
    .filter((m) => m.familyId === familyId && m.status === 'ACTIVE')
    .sort(
      (a, b) =>
        Number(b.id === self.id) - Number(a.id === self.id) || Number(managed.has(b.id)) - Number(managed.has(a.id)),
    )
    .map((member) => ({ member, isSelf: member.id === self.id, ...memberAccess(familyId, userId, member.id) }))
    .filter(({ manage, categories }) => manage || categories.size > 0)
}

/** Quem se pode escolher no relatório individual. */
export function listReportSubjects(familyId: string, userId: string) {
  return respond((): ReportSubject[] =>
    reportSubjects(familyId, userId).map(({ member, isSelf }) => ({ member: toPublic(member), isSelf })),
  )
}

/**
 * Visão familiar (UC-RPT-02): por membro visível, alergias, condições, medicamentos ativos,
 * próximas consultas e exames e pendentes — só nas categorias que o utilizador pode ver.
 * O Admin não vê mais por ser Admin (D13).
 */
export function getFamilyReport(familyId: string, userId: string, now: Date = new Date()) {
  return respond((): FamilyReport => {
    const family = db.families.find((f) => f.id === familyId)
    if (!family) throw new AppError('NOT_FOUND')
    expireRequests(now)
    const today = todayISO(now)

    const members = reportSubjects(familyId, userId).map(({ member, isSelf, manage, categories }) => {
      const owned = ofMember(familyId, member.id)
      const can = (category: SharingCategory) => categories.has(category)
      const name = member.name
      return {
        member: toPublic(member),
        isSelf,
        manage,
        categories: SHARING_CATEGORIES.filter(can),
        allergies: can('ALLERGIES') ? db.allergies.filter(owned).map((a) => a.name) : undefined,
        conditions: can('CONDITIONS')
          ? db.conditions.filter((c) => owned(c) && c.kind === 'CONDITION').map((c) => c.name)
          : undefined,
        activeMedications: can('MEDICATION')
          ? db.medicationPlans.filter((p) => owned(p) && p.status === 'ACTIVE').map((p) => summarize(p, now))
          : undefined,
        upcomingAppointments: can('APPOINTMENTS')
          ? db.appointments
              .filter(
                (a) =>
                  owned(a) &&
                  (a.status === 'SCHEDULED' || a.status === 'REQUESTED') &&
                  Date.parse(a.scheduledAt) > now.getTime(),
              )
              .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
              .map((appointment) => ({ appointment, memberName: name }))
          : undefined,
        upcomingExaminations: can('EXAMS')
          ? db.examinations
              .filter((e) => owned(e) && e.status === 'SCHEDULED' && e.examDate >= today)
              .sort((a, b) => a.examDate.localeCompare(b.examDate))
              .map((examination) => ({ examination, memberName: name, resultCount: 0 }))
          : undefined,
        pending: pendingItems(familyId, [member.id], now).filter((p) => can(PENDING_CATEGORY[p.type])),
      }
    })

    const familySize = db.members.filter((m) => m.familyId === familyId && m.status === 'ACTIVE').length
    return { generatedAt: now.toISOString(), family, familySize, members }
  })
}

/** Período por defeito e máximo do relatório individual (BR-RPT-02). */
export const REPORT_DEFAULT_MONTHS = 12
export const REPORT_MAX_YEARS = 5

/** Período pedido, com o de defeito; fora dos limites → VALIDATION_ERROR. */
function resolvePeriod(period: Partial<ReportPeriod>, now: Date): ReportPeriod {
  const to = period.to ?? todayISO(now)
  const from = period.from ?? monthsBefore(to, REPORT_DEFAULT_MONTHS)
  if (!isValidISODate(from) || !isValidISODate(to) || from > to || from < monthsBefore(to, REPORT_MAX_YEARS * 12)) {
    throw new AppError('VALIDATION_ERROR')
  }
  return { from, to }
}

/**
 * Relatório individual (UC-RPT-01): perfil e, por categoria visível, saúde, medicação e tomas,
 * consultas e exames do período (e os próximos). Secções sem permissão são omitidas (BR-RPT-01).
 */
export function getMemberReport(
  familyId: string,
  userId: string,
  memberId: string,
  period: Partial<ReportPeriod> = {},
  now: Date = new Date(),
) {
  return respond((): MemberReport => {
    const subject = reportSubjects(familyId, userId).find((s) => s.member.id === memberId)
    if (!subject) throw new AppError('NOT_FOUND')
    const { member, isSelf, manage, categories } = subject
    const { from, to } = resolvePeriod(period, now)
    expireRequests(now)
    const owned = ofMember(familyId, memberId)
    const can = (category: SharingCategory) => categories.has(category)
    const name = member.name
    // Data (yyyy-mm-dd) dentro do período, ou ainda por vir.
    const inPeriod = (date: string) => date.slice(0, 10) >= from && date.slice(0, 10) <= to
    const fromStart = new Date(`${from}T00:00`).getTime()
    const toEnd = new Date(`${to}T23:59:59.999`).getTime()

    const plans = db.medicationPlans.filter(owned)
    const adherence = plans
      .map((plan): AdherenceItem => {
        const doses = db.doses.filter((d) => {
          const at = Date.parse(d.scheduledAt)
          return d.planId === plan.id && at >= fromStart && at <= toEnd
        })
        const count = (status: DoseStatus) => doses.filter((d) => d.status === status).length
        return {
          planId: plan.id,
          medicationName: `${plan.name} ${plan.dosage}`,
          taken: count('TAKEN'),
          notTaken: count('NOT_TAKEN'),
          unconfirmed: count('UNCONFIRMED'),
          pending: count('PENDING'),
        }
      })
      .filter((item) => item.taken + item.notTaken + item.unconfirmed + item.pending > 0)

    return {
      generatedAt: now.toISOString(),
      from,
      to,
      member: toPublic(member),
      isSelf,
      manage,
      categories: SHARING_CATEGORIES.filter(can),
      bloodType: can('ALLERGIES') ? member.bloodType : undefined,
      allergies: can('ALLERGIES') ? db.allergies.filter(owned).map((a) => a.name) : undefined,
      conditions: can('CONDITIONS') ? db.conditions.filter(owned) : undefined,
      prescriptions: can('MEDICATION')
        ? db.prescriptions
            .filter((p) => owned(p) && (p.status === 'ACTIVE' || inPeriod(p.issuedOn)))
            .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn))
            .map((prescription) => ({
              prescription,
              memberName: name,
              medicationCount: plans.filter((p) => p.prescriptionId === prescription.id).length,
            }))
        : undefined,
      medications: can('MEDICATION')
        ? plans.filter((p) => p.status === 'ACTIVE').map((p) => summarize(p, now))
        : undefined,
      adherence: can('MEDICATION') ? adherence : undefined,
      appointments: can('APPOINTMENTS')
        ? db.appointments
            .filter(
              (a) =>
                owned(a) &&
                REPORTED_APPOINTMENTS.includes(a.status) &&
                Date.parse(a.scheduledAt) >= fromStart &&
                (Date.parse(a.scheduledAt) > now.getTime() || Date.parse(a.scheduledAt) <= toEnd),
            )
            .sort(upcomingFirst(now))
            .map((appointment) => ({ appointment, memberName: name }))
        : undefined,
      examinations: can('EXAMS')
        ? db.examinations
            .filter((e) => owned(e) && e.examDate >= from && (e.examDate <= to || e.status === 'SCHEDULED'))
            .sort((a, b) => b.examDate.localeCompare(a.examDate))
            .map((examination) => ({
              examination,
              memberName: name,
              resultCount: db.examResults.filter((r) => r.examinationId === examination.id).length,
            }))
        : undefined,
      pending: pendingItems(familyId, [memberId], now).filter((p) => can(PENDING_CATEGORY[p.type])),
    }
  })
}
