import { AppError } from '@/lib/errors'
import { buildTextPdf } from '@/lib/pdf'
import type { Examination } from '@/types/examination'
import type { ClinicExamOrder, ClinicExamServiceTypeOption, ExamOrderItemInput, ExamOrderStatus, FamilyExamOrder } from '@/types/examOrder'
import { memberAccess } from '../access'
import { patientOfMember } from '../clinicPatients'
import { recordClinicAudit, requireAnyAccount } from '../clinicRoles'
import type { MockClinicAccountRecord } from '../data/clinicAccounts'
import {
  activeOrdersOf,
  assertRoom,
  cleanItems,
  clinicStatusOf,
  familyStatusOf,
  orderPdfLines,
  statementPdfLines,
  toClinicOrder,
  toFamilyOrder,
} from '../examOrders'
import { db, newId, type MockExamOrder } from '../db'
import { raiseAlerts } from '../alertRules'
import { respond, respondBlob } from '../respond'
import { findBooking, type ReportBooking } from './clinicReports'

/*
 * Pedidos de exame e declaração de presença (M15 U/V, ADR-028). Permissões decididas aqui, nunca
 * só na UI: só o Médico escreve/cancela nas marcações do seu profissional (BR-CLN-51); Admin, Gestor
 * e Médico leem e imprimem. `INVALID_STATE_TRANSITION` do contrato mapeia para `CONFLICT` (o
 * `ErrorCode` da UI ainda não o distingue).
 */

const clinicNameOf = (clinicId: string) => db.clinics.find((c) => c.id === clinicId)?.name ?? ''

function requireDoctor(account: MockClinicAccountRecord) {
  if (account.role !== 'CLINIC_DOCTOR') throw new AppError('FORBIDDEN')
}

const authorNameOf = (account: MockClinicAccountRecord) =>
  db.professionals.find((p) => p.id === account.professionalId)?.name ?? ''

/** Consulta Vita ou visita manual em `SCHEDULED`/`COMPLETED` (BR-CLN-51). */
function requireOpen(booking: ReportBooking) {
  if (booking.status !== 'SCHEDULED' && booking.status !== 'COMPLETED') throw new AppError('CONFLICT')
}

/** Data de nascimento só se o `ClinicPatient` a tem (BR-CLN-51). */
function birthDateOf(clinicId: string, booking: ReportBooking): string | undefined {
  if (booking.kind === 'VISIT') {
    const visit = db.clinicVisits.find((v) => v.id === booking.id)
    return db.clinicPatients.find((p) => p.id === visit?.clinicPatientId)?.birthDate ?? undefined
  }
  return patientOfMember(clinicId, booking.appointment.memberId)?.birthDate ?? undefined
}

function insertOrders(
  account: MockClinicAccountRecord,
  booking: ReportBooking,
  items: ExamOrderItemInput[],
  now: Date,
): MockExamOrder[] {
  const cleaned = cleanItems(account.clinicId, items)
  assertRoom(account.clinicId, booking.id, cleaned.length)
  const birth = birthDateOf(account.clinicId, booking)
  const created = cleaned.map((item): MockExamOrder => ({
    id: newId('xor'),
    clinicId: account.clinicId,
    bookingKind: booking.kind,
    bookingId: booking.id,
    ...item,
    cancelled: false,
    patientName: booking.patientName,
    patientBirthDate: birth,
    consultationAt: booking.scheduledAt,
    authorName: authorNameOf(account),
    createdAt: now.toISOString(),
    ...(booking.kind === 'APPOINTMENT'
      ? { link: { familyId: booking.appointment.familyId, memberId: booking.appointment.memberId, appointmentId: booking.id } }
      : {}),
  }))
  db.examOrders.push(...created)
  for (const order of created) {
    recordClinicAudit(account, 'EXAM_ORDER_CREATED', 'ExamOrder', order.id)
    // Um alerta genérico por pedido, só em consultas Vita (BR-CLN-53).
    if (order.link) {
      raiseAlerts(db, [
        {
          familyId: order.link.familyId,
          memberId: order.link.memberId,
          type: 'EXAM_ORDER_ADDED',
          ruleKey: 'exam-order.added',
          sourceType: 'APPOINTMENT',
          sourceId: order.link.appointmentId,
          triggerAt: now.toISOString(),
          occurrence: order.id,
        },
      ])
    }
  }
  return created
}

/**
 * `complete` com `examOrders` (BR-CLN-51): valida tudo **antes** de a conclusão mexer em dados e
 * devolve a função que grava (mesma operação). Admin/Gestor ⇒ FORBIDDEN, nada se grava.
 */
export function prepareExamOrdersOnComplete(
  account: MockClinicAccountRecord,
  bookingId: string,
  items: ExamOrderItemInput[],
  now: Date,
): () => void {
  requireDoctor(account)
  const booking = findBooking(account, bookingId)
  cleanItems(account.clinicId, items)
  assertRoom(account.clinicId, booking.id, items.length)
  return () => {
    insertOrders(account, booking, items, now)
  }
}

const listOf = (account: MockClinicAccountRecord, bookingId: string): ClinicExamOrder[] =>
  db.examOrders
    .filter((o) => o.clinicId === account.clinicId && o.bookingId === bookingId)
    .map(toClinicOrder)

// --- Clínica: `/clinic-portal/agenda/{id}/exam-orders*` ---

/** `GET /clinic-portal/exam-service-types`: Admin/Gestor/Médico; só EXAM ativos da clínica, sem preço. */
export function listClinicExamServiceTypes(clinicAccountId: string) {
  return respond((): ClinicExamServiceTypeOption[] => {
    const account = requireAnyAccount(clinicAccountId)
    return db.services
      .filter((s) => s.clinicId === account.clinicId && s.kind === 'EXAM' && s.active)
      .map(({ id, name, durationMinutes }) => ({ id, name, durationMinutes }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-PT'))
  })
}

export function listClinicExamOrders(clinicAccountId: string, bookingId: string) {
  return respond((): { items: ClinicExamOrder[] } => {
    const account = requireAnyAccount(clinicAccountId)
    const booking = findBooking(account, bookingId)
    recordClinicAudit(account, 'EXAM_ORDER_VIEWED', 'ExamOrder', booking.id)
    return { items: listOf(account, booking.id) }
  })
}

export function createClinicExamOrders(
  clinicAccountId: string,
  bookingId: string,
  items: ExamOrderItemInput[],
  now: Date = new Date(),
) {
  return respond((): { items: ClinicExamOrder[] } => {
    const account = requireAnyAccount(clinicAccountId)
    requireDoctor(account)
    const booking = findBooking(account, bookingId)
    requireOpen(booking)
    insertOrders(account, booking, items, now)
    return { items: listOf(account, booking.id) }
  })
}

export function cancelClinicExamOrder(clinicAccountId: string, bookingId: string, orderId: string, now: Date = new Date()) {
  return respond((): ClinicExamOrder => {
    const account = requireAnyAccount(clinicAccountId)
    requireDoctor(account)
    const booking = findBooking(account, bookingId)
    const order = db.examOrders.find((o) => o.id === orderId && o.clinicId === account.clinicId && o.bookingId === booking.id)
    if (!order) throw new AppError('NOT_FOUND')
    if (order.cancelled) return toClinicOrder(order)
    if (clinicStatusOf(order) === 'FULFILLED') throw new AppError('CONFLICT')
    // Cancelar desfaz a ligação mas não toca no exame do paciente (BR-CLN-52).
    order.cancelled = true
    order.cancelledAt = now.toISOString()
    order.examinationId = undefined
    order.bookedHere = undefined
    recordClinicAudit(account, 'EXAM_ORDER_CANCELLED', 'ExamOrder', order.id)
    return toClinicOrder(order)
  })
}

export function getClinicExamOrdersPdf(clinicAccountId: string, bookingId: string) {
  return respondBlob((): Blob => {
    const account = requireAnyAccount(clinicAccountId)
    const booking = findBooking(account, bookingId)
    const active = activeOrdersOf(account.clinicId, booking.id)
    if (active.length === 0) throw new AppError('NOT_FOUND')
    recordClinicAudit(account, 'EXAM_ORDER_VIEWED', 'ExamOrder', booking.id)
    return buildTextPdf(orderPdfLines(clinicNameOf(account.clinicId), active))
  })
}

/** Elegível: `COMPLETED` ou `SCHEDULED` com `arrivedAt` (BR-CLN-55). */
function attended(booking: ReportBooking): boolean {
  if (booking.status === 'COMPLETED') return true
  if (booking.status !== 'SCHEDULED') return false
  const source =
    booking.kind === 'APPOINTMENT' ? booking.appointment : db.clinicVisits.find((v) => v.id === booking.id)
  return Boolean(source?.arrivedAt)
}

export function getClinicAttendanceStatementPdf(
  clinicAccountId: string,
  bookingId: string,
  includeProfessional = false,
  now: Date = new Date(),
) {
  return respondBlob((): Blob => {
    const account = requireAnyAccount(clinicAccountId)
    const booking = findBooking(account, bookingId)
    if (!attended(booking)) throw new AppError('CONFLICT')
    recordClinicAudit(account, 'ATTENDANCE_STATEMENT_ISSUED', 'Appointment', booking.id)
    const professional = booking.kind === 'APPOINTMENT' ? booking.appointment.professionalName : db.clinicVisits.find((v) => v.id === booking.id)?.professionalName
    return buildTextPdf(
      statementPdfLines({
        clinicName: clinicNameOf(account.clinicId),
        patientName: booking.patientName,
        scheduledAt: booking.scheduledAt,
        professionalName: includeProfessional ? professional : undefined,
        issuedAt: now.toISOString(),
      }),
    )
  })
}

// --- Família: `/families/{f}/members/{m}/exam-orders` e `examOrderId` ao marcar (BR-CLN-52/53) ---

/** Titular (`SELF`) ou tutor; `DEPENDENT_SELF`/`OTHER` (mesmo com partilha) ⇒ FORBIDDEN. */
function requireOwner(familyId: string, userId: string, memberId: string) {
  if (!memberAccess(familyId, userId, memberId).manage) throw new AppError('FORBIDDEN')
}

export function listFamilyExamOrders(
  familyId: string,
  userId: string,
  memberId: string,
  filter: { status?: ExamOrderStatus; appointmentId?: string } = {},
) {
  return respond((): { items: FamilyExamOrder[] } => {
    requireOwner(familyId, userId, memberId)
    const items = db.examOrders
      .filter((o) => o.link?.familyId === familyId && o.link.memberId === memberId)
      .filter((o) => !filter.appointmentId || o.link?.appointmentId === filter.appointmentId)
      .map(toFamilyOrder)
      // Por omissão exclui CANCELLED.
      .filter((o) => (filter.status ? o.status === filter.status : o.status !== 'CANCELLED'))
      .sort((a, b) => b.orderedAt.localeCompare(a.orderedAt))
    return { items }
  })
}

/**
 * Liga um exame recém-criado ao pedido (porta `ExamOrderLinker.link`): mesmo membro, visível ao
 * ator (senão `NOT_FOUND`) e `ORDERED` (senão `CONFLICT`). Chamado antes de gravar o exame.
 */
export function prepareExamOrderLink(
  familyId: string,
  userId: string,
  memberId: string,
  orderId: string,
): (exam: Examination) => void {
  const order = db.examOrders.find((o) => o.id === orderId)
  if (!order?.link || order.link.familyId !== familyId || order.link.memberId !== memberId) throw new AppError('NOT_FOUND')
  requireOwner(familyId, userId, memberId)
  if (order.cancelled || familyStatusOf(order) !== 'ORDERED') throw new AppError('CONFLICT')
  return (exam) => {
    order.examinationId = exam.id
    order.bookedHere = Boolean(exam.clinicId) && exam.clinicId === order.clinicId
    // EXAM_ORDER_LINKED fica na auditoria do servidor, não na da clínica (não revela `booked_here`).
  }
}
