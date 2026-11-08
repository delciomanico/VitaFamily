import { addFollowUp, isSameLocalDay } from '@/lib/clinicDay'
import { localDay } from '@/lib/appointment'
import { todayISO } from '@/lib/date'
import { AppError } from '@/lib/errors'
import type {
  ClinicBooking,
  ClinicFollowUp,
  ClinicFollowUpInput,
  ClinicReportCounts,
  ClinicReportRow,
  ClinicReportSummary,
  ConfirmationStatus,
} from '@/types/clinic'
import { FOLLOW_UP_MAX_AMOUNT } from '@/types/clinic'
import { memberName } from '../access'
import { FOLLOWUP_REMINDER_DAYS } from '../alertRules'
import { expireRequests } from '../bookings'
import { patientOfMember } from '../clinicPatients'
import { ownsAppointment, ownsVisit, requireStaffAccount, scrubReceipt } from '../clinicRoles'
import { db } from '../db'
import { respond } from '../respond'
import type { MockClinicAccountRecord } from '../data/clinicAccounts'
import { requireAccount, toBooking, toVisitBooking } from './clinicPortal'

/*
 * Dia da clínica (M14 Q, BR-CLN-25..30): confirmado por telefone, chegou/iniciar/faltou, retorno e
 * indicadores. Consultas Vita e visitas manuais despacham-se pelo id, como cancel/complete.
 * Nunca recebe nem devolve ids Vita; os indicadores são só contagens (BR-CLN-29).
 */

/** O que as ações do dia leem e escrevem, comum a consultas Vita e a visitas manuais. */
interface DayRecord {
  status: string
  scheduledAt: string
  arrivedAt?: string
  startedAt?: string
  confirmationStatus?: ConfirmationStatus
  confirmationSource?: 'PATIENT' | 'CLINIC'
  followUpDueOn?: string
}

interface Target {
  record: DayRecord
  view: (now: Date) => ClinicBooking
}

/**
 * Marcação desta clínica (consulta Vita ou visita manual); de outra → NOT_FOUND (sem enumeração).
 * O Médico só chega às suas (BR-CLN-39) e nunca recebe `receiptId`.
 */
function findTarget(account: MockClinicAccountRecord, id: string): Target {
  const { clinicId } = account
  const visit = db.clinicVisits.find((v) => v.id === id && v.clinicId === clinicId)
  if (visit) {
    if (!ownsVisit(account, visit)) throw new AppError('NOT_FOUND')
    return { record: visit, view: (now) => scrubReceipt(account, toVisitBooking(visit, now)) }
  }
  const appointment = db.appointments.find((a) => a.id === id && a.clinicId === clinicId)
  if (!appointment || !ownsAppointment(account, appointment)) throw new AppError('NOT_FOUND')
  return { record: appointment, view: (now) => scrubReceipt(account, toBooking(appointment, now)) }
}

const isFuture = (record: DayRecord, now: Date) => Date.parse(record.scheduledAt) > now.getTime()

/** `PUT /clinic-portal/agenda/{id}/confirm` (BR-CLN-27): SCHEDULED e futura → CONFIRMED (CLINIC). */
export function confirmClinicBookingByPhone(clinicAccountId: string, id: string, now: Date = new Date()) {
  return respond((): ClinicBooking => {
    const account = requireStaffAccount(clinicAccountId)
    expireRequests(now)
    const { record, view } = findTarget(account, id)
    if (record.status !== 'SCHEDULED' || !isFuture(record, now)) throw new AppError('CONFLICT')
    record.confirmationStatus = 'CONFIRMED'
    record.confirmationSource = 'CLINIC'
    return view(now)
  })
}

/**
 * `PUT …/arrive` (BR-CLN-28): SCHEDULED ou NO_SHOW (correção) no dia local; `arrivedAt` só uma vez;
 * a partir de NO_SHOW volta a SCHEDULED.
 */
export function arriveClinicBooking(clinicAccountId: string, id: string, now: Date = new Date()) {
  return respond((): ClinicBooking => {
    const account = requireStaffAccount(clinicAccountId)
    expireRequests(now)
    const { record, view } = findTarget(account, id)
    if ((record.status !== 'SCHEDULED' && record.status !== 'NO_SHOW') || !isSameLocalDay(record.scheduledAt, now)) {
      throw new AppError('CONFLICT')
    }
    record.status = 'SCHEDULED'
    record.arrivedAt ??= now.toISOString()
    return view(now)
  })
}

/** `PUT …/start` (BR-CLN-28): SCHEDULED no dia local; `startedAt` (e `arrivedAt` se faltar) uma só vez. */
export function startClinicBooking(clinicAccountId: string, id: string, now: Date = new Date()) {
  return respond((): ClinicBooking => {
    const account = requireAccount(clinicAccountId)
    expireRequests(now)
    const { record, view } = findTarget(account, id)
    if (record.status !== 'SCHEDULED' || !isSameLocalDay(record.scheduledAt, now)) throw new AppError('CONFLICT')
    record.arrivedAt ??= now.toISOString()
    record.startedAt ??= now.toISOString()
    return view(now)
  })
}

/** `PUT …/no-show` (BR-CLN-28): SCHEDULED, hora já iniciada e sem `startedAt` → NO_SHOW. Idempotente. */
export function noShowClinicBooking(clinicAccountId: string, id: string, now: Date = new Date()) {
  return respond((): ClinicBooking => {
    const account = requireStaffAccount(clinicAccountId)
    expireRequests(now)
    const { record, view } = findTarget(account, id)
    if (record.status === 'NO_SHOW') return view(now)
    if (record.status !== 'SCHEDULED' || isFuture(record, now) || record.startedAt) throw new AppError('CONFLICT')
    record.status = 'NO_SHOW'
    return view(now)
  })
}

// --- Retorno (BR-CLN-30) ---

/** `PUT …/follow-up`: "voltar em N semanas/meses" numa marcação COMPLETED; substitui o anterior. */
export function setClinicFollowUp(clinicAccountId: string, id: string, input: ClinicFollowUpInput, now: Date = new Date()) {
  return respond((): ClinicBooking => {
    const account = requireAccount(clinicAccountId)
    const { record, view } = findTarget(account, id)
    const validAmount = Number.isInteger(input.amount) && input.amount >= 1 && input.amount <= FOLLOW_UP_MAX_AMOUNT
    if (!validAmount || (input.unit !== 'WEEKS' && input.unit !== 'MONTHS')) throw new AppError('VALIDATION_ERROR')
    if (record.status !== 'COMPLETED') throw new AppError('CONFLICT')
    record.followUpDueOn = addFollowUp(localDay(record.scheduledAt), input)
    return view(now)
  })
}

/** `DELETE …/follow-up`: dá o retorno por tratado (idempotente). */
export function clearClinicFollowUp(clinicAccountId: string, id: string, now: Date = new Date()) {
  return respond((): ClinicBooking => {
    const account = requireAccount(clinicAccountId)
    const { record, view } = findTarget(account, id)
    record.followUpDueOn = undefined
    return view(now)
  })
}

const addDays = (day: string, days: number) => {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  return todayISO(new Date(year, month - 1, date + days))
}

/** `GET /clinic-portal/follow-ups?until`: retornos por tratar até `until` (omissão: hoje + 14 dias). */
export function listClinicFollowUps(clinicAccountId: string, until?: string, now: Date = new Date()) {
  return respond((): ClinicFollowUp[] => {
    const account = requireAccount(clinicAccountId)
    const { clinicId } = account
    if (until !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new AppError('VALIDATION_ERROR')
    const today = todayISO(now)
    const limit = until ?? addDays(today, 14)
    const notified = (dueOn: string) => today >= addDays(dueOn, -FOLLOWUP_REMINDER_DAYS)
    const items: ClinicFollowUp[] = []
    for (const a of db.appointments) {
      if (a.clinicId !== clinicId || a.status !== 'COMPLETED' || !a.followUpDueOn || a.followUpDueOn > limit) continue
      if (!ownsAppointment(account, a)) continue
      const patient = patientOfMember(clinicId, a.memberId)
      items.push({
        bookingId: a.id,
        source: 'VITA',
        clinicPatientId: patient?.id ?? null,
        patientName: memberName(a.memberId),
        patientPhone: patient?.phone ?? null,
        dueOn: a.followUpDueOn,
        patientNotified: notified(a.followUpDueOn),
      })
    }
    for (const v of db.clinicVisits) {
      if (v.clinicId !== clinicId || v.status !== 'COMPLETED' || !v.followUpDueOn || v.followUpDueOn > limit) continue
      if (!ownsVisit(account, v)) continue
      const patient = db.clinicPatients.find((p) => p.id === v.clinicPatientId)
      items.push({
        bookingId: v.id,
        source: 'MANUAL',
        clinicPatientId: v.clinicPatientId,
        patientName: patient?.name ?? '',
        patientPhone: patient?.phone ?? null,
        dueOn: v.followUpDueOn,
        patientNotified: false,
      })
    }
    return items.sort((a, b) => a.dueOn.localeCompare(b.dueOn)).slice(0, 200)
  })
}

// --- Indicadores (BR-CLN-29) ---

const MAX_REPORT_DAYS = 366
const ACTIVE_OR_DONE = ['REQUESTED', 'SCHEDULED', 'COMPLETED', 'NO_SHOW']

const emptyCounts = (): ClinicReportCounts => ({
  slotsTotal: 0,
  slotsBooked: 0,
  occupancyRate: null,
  completed: 0,
  noShows: 0,
  noShowRate: null,
  cancellations: 0,
  declinedByPatient: 0,
})

/** Taxas derivadas das contagens (0..1; nulas sem denominador). */
function withRates(c: ClinicReportCounts): ClinicReportCounts {
  return {
    ...c,
    occupancyRate: c.slotsTotal > 0 ? c.slotsBooked / c.slotsTotal : null,
    noShowRate: c.completed + c.noShows > 0 ? c.noShows / (c.completed + c.noShows) : null,
  }
}

/**
 * `GET /clinic-portal/reports/summary?from&to&professionalId?`: janela de dias locais [from, to]
 * inclusivos (≤ 366 dias). Só contagens e taxas, nunca nomes nem ids de pacientes. As marcações
 * sem horário contam em realizadas/faltas/cancelamentos mas não na ocupação.
 */
export function getClinicReportSummary(
  clinicAccountId: string,
  params: { from: string; to: string; professionalId?: string },
  now: Date = new Date(),
) {
  return respond((): ClinicReportSummary => {
    const { clinicId } = requireStaffAccount(clinicAccountId)
    const { from, to, professionalId } = params
    const valid = /^\d{4}-\d{2}-\d{2}$/
    if (!valid.test(from) || !valid.test(to) || to < from) throw new AppError('VALIDATION_ERROR')
    const [fy = 0, fm = 1, fd = 1] = from.split('-').map(Number)
    const [ty = 0, tm = 1, td = 1] = to.split('-').map(Number)
    const span = (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000 + 1
    if (span > MAX_REPORT_DAYS) throw new AppError('VALIDATION_ERROR')
    if (professionalId && !db.professionals.some((p) => p.id === professionalId && p.clinicId === clinicId)) {
      throw new AppError('NOT_FOUND')
    }
    expireRequests(now)

    const inWindow = (iso: string) => {
      const day = localDay(iso)
      return day >= from && day <= to
    }
    const rows = new Map<string | null, ClinicReportCounts>()
    const row = (id: string | null) => {
      if (!rows.has(id)) rows.set(id, emptyCounts())
      return rows.get(id)!
    }
    const slotOf = (id?: string) => db.slots.find((s) => s.id === id)

    for (const slot of db.slots) {
      if (slot.clinicId !== clinicId || !inWindow(slot.startsAt)) continue
      const booked =
        slot.kind === 'EXAM'
          ? db.examinations.filter((e) => e.slotId === slot.id && (e.status === 'SCHEDULED' || e.status === 'COMPLETED'))
              .length
          : db.appointments.filter((a) => a.slotId === slot.id && ACTIVE_OR_DONE.includes(a.status)).length +
            db.clinicVisits.filter((v) => v.slotId === slot.id && ACTIVE_OR_DONE.includes(v.status)).length
      const counts = row(slot.professionalId ?? null)
      counts.slotsTotal += slot.capacity
      counts.slotsBooked += Math.min(slot.capacity, booked)
    }

    const tally = (professional: string | null, status: string, confirmation?: ConfirmationStatus) => {
      const counts = row(professional)
      if (status === 'COMPLETED') counts.completed += 1
      if (status === 'NO_SHOW') counts.noShows += 1
      if (status === 'CANCELLED') {
        counts.cancellations += 1
        if (confirmation === 'DECLINED') counts.declinedByPatient += 1
      }
    }
    for (const a of db.appointments) {
      if (a.clinicId !== clinicId || !inWindow(a.scheduledAt)) continue
      tally(slotOf(a.slotId)?.professionalId ?? null, a.status, a.confirmationStatus)
    }
    for (const v of db.clinicVisits) {
      if (v.clinicId !== clinicId || !inWindow(v.scheduledAt)) continue
      tally(v.professionalId ?? slotOf(v.slotId)?.professionalId ?? null, v.status, v.confirmationStatus)
    }

    const byProfessional: ClinicReportRow[] = [...rows.entries()]
      .filter(([id]) => !professionalId || id === professionalId)
      .map(([id, counts]) => ({
        ...withRates(counts),
        professionalId: id,
        professionalName: id ? (db.professionals.find((p) => p.id === id)?.name ?? null) : null,
      }))
      .sort((a, b) => (a.professionalName ?? '￿').localeCompare(b.professionalName ?? '￿', 'pt-PT'))

    const sum = byProfessional.reduce((acc, r) => {
      acc.slotsTotal += r.slotsTotal
      acc.slotsBooked += r.slotsBooked
      acc.completed += r.completed
      acc.noShows += r.noShows
      acc.cancellations += r.cancellations
      acc.declinedByPatient += r.declinedByPatient
      return acc
    }, emptyCounts())

    return {
      from,
      to,
      totals: {
        ...withRates(sum),
        // Da clínica inteira, não se filtra por profissional.
        newPatients: db.clinicPatients.filter((p) => p.clinicId === clinicId && inWindow(p.createdAt)).length,
        examsCompleted: db.examinations.filter(
          (e) => e.clinicId === clinicId && e.status === 'COMPLETED' && e.slotId && inWindow(slotOf(e.slotId)?.startsAt ?? e.examDate),
        ).length,
      },
      byProfessional,
    }
  })
}
