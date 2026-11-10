import { AppError } from '@/lib/errors'
import { formatLongDate, formatTime } from '@/lib/format'
import {
  EXAM_ORDER_MAX_ACTIVE,
  EXAM_ORDER_NAME_MAX,
  EXAM_ORDER_NOTE_MAX,
  type ClinicExamOrder,
  type ExamOrderItemInput,
  type ExamOrderStatus,
  type FamilyExamOrder,
} from '@/types/examOrder'
import { db } from './db'
import type { MockExamOrder } from './db'

/*
 * Regras puras dos pedidos de exame no backend simulado (M15 U, ADR-028). Nada aqui depende dos
 * handlers, para que `clinicPortal` (concluir), `examinations` (marcar) e `examOrders` (rotas) as
 * partilhem. Espelha a porta `ExamOrderLinker` (link/release/fulfil) por derivação do exame ligado.
 */

export const ORDER_FOOTER = 'Documento não fiscal. Não substitui receita médica nem atestado.'
export const STATEMENT_FOOTER = 'Documento não fiscal. Não é atestado médico nem comprova a existência de doença.'

/** Caracteres de controlo (BR-CLN-51). */
const CONTROL = /[\u0000-\u001F\u007F]/

/** Exame ligado ainda válido (existe e não foi cancelado); senão a ligação desfez-se (BR-CLN-52). */
function linkedExam(order: MockExamOrder) {
  const exam = order.examinationId ? db.examinations.find((e) => e.id === order.examinationId) : undefined
  return exam && exam.status !== 'CANCELLED' ? exam : undefined
}

/** Estado ao paciente: conforme o exame ligado, de qualquer clínica. */
export function familyStatusOf(order: MockExamOrder): ExamOrderStatus {
  if (order.cancelled) return 'CANCELLED'
  const exam = linkedExam(order)
  if (!exam) return 'ORDERED'
  return exam.status === 'COMPLETED' ? 'FULFILLED' : 'SCHEDULED'
}

/** Estado à clínica: SCHEDULED/FULFILLED só se o exame é da própria clínica (`booked_here`). */
export function clinicStatusOf(order: MockExamOrder): ExamOrderStatus {
  const status = familyStatusOf(order)
  return status === 'SCHEDULED' || status === 'FULFILLED' ? (order.bookedHere ? status : 'ORDERED') : status
}

export const activeOrdersOf = (clinicId: string, bookingId: string) =>
  db.examOrders.filter((o) => o.clinicId === clinicId && o.bookingId === bookingId && !o.cancelled)

/** Pedidos não cancelados de uma marcação (ids únicos), para o contador `examOrderCount`. */
export const activeOrderCountOf = (bookingId: string) => db.examOrders.filter((o) => o.bookingId === bookingId && !o.cancelled).length

/** Pedidos não cancelados de uma consulta Vita visíveis a quem pode ler (BR-CLN-53). */
export const examOrderCountOf = (appointmentId: string) =>
  db.examOrders.filter((o) => o.link?.appointmentId === appointmentId && !o.cancelled).length

export function toClinicOrder(order: MockExamOrder): ClinicExamOrder {
  const { clinicId: _c, cancelled: _x, link: _l, examinationId: _e, bookedHere: _b, ...view } = order
  return { ...view, status: clinicStatusOf(order) }
}

export function toFamilyOrder(order: MockExamOrder): FamilyExamOrder {
  const exam = linkedExam(order)
  return {
    id: order.id,
    appointmentId: order.link?.appointmentId ?? '',
    clinicId: order.clinicId,
    clinicName: db.clinics.find((c) => c.id === order.clinicId)?.name ?? '',
    name: order.name,
    note: order.note,
    urgent: order.urgent,
    status: familyStatusOf(order),
    examinationId: !order.cancelled && exam ? exam.id : undefined,
    orderedAt: order.createdAt,
  }
}

/** Normaliza e valida os itens (1–5; nome ou serviço de exame ativo da clínica; limites). */
export function cleanItems(clinicId: string, items: ExamOrderItemInput[]): Array<Pick<MockExamOrder, 'name' | 'serviceTypeId' | 'note' | 'urgent'>> {
  if (items.length < 1 || items.length > EXAM_ORDER_MAX_ACTIVE) throw new AppError('VALIDATION_ERROR')
  return items.map((item) => {
    const name = item.name?.trim()
    if (Boolean(name) === Boolean(item.serviceTypeId)) throw new AppError('VALIDATION_ERROR')
    const note = item.note?.trim() || undefined
    if ((name && (name.length > EXAM_ORDER_NAME_MAX || CONTROL.test(name))) || (note && (note.length > EXAM_ORDER_NOTE_MAX || CONTROL.test(note)))) {
      throw new AppError('VALIDATION_ERROR')
    }
    if (!item.serviceTypeId) return { name: name as string, note, urgent: item.urgent ?? false }
    const service = db.services.find((s) => s.id === item.serviceTypeId && s.clinicId === clinicId)
    if (!service) throw new AppError('NOT_FOUND')
    if (service.kind !== 'EXAM' || !service.active) throw new AppError('VALIDATION_ERROR')
    return { name: service.name.slice(0, EXAM_ORDER_NAME_MAX), serviceTypeId: service.id, note, urgent: item.urgent ?? false }
  })
}

/** No máximo 5 pedidos ativos por marcação (BR-CLN-51). */
export function assertRoom(clinicId: string, bookingId: string, adding: number) {
  if (activeOrdersOf(clinicId, bookingId).length + adding > EXAM_ORDER_MAX_ACTIVE) throw new AppError('LIMIT_EXCEEDED')
}

const when = (iso: string) => `${formatLongDate(iso)} ${formatTime(iso)}`

/** Linhas do PDF "Pedido de exame" (só pedidos ativos, texto simples). */
export function orderPdfLines(clinicName: string, orders: MockExamOrder[]): string[] {
  const first = orders[0]
  if (!first) return []
  const lines = [
    clinicName,
    'PEDIDO DE EXAME',
    '',
    `Paciente: ${first.patientName}${first.patientBirthDate ? ` (nascimento: ${formatLongDate(first.patientBirthDate)})` : ''}`,
    `Data da consulta: ${when(first.consultationAt)}`,
    '',
  ]
  orders.forEach((o, i) => {
    lines.push(`${i + 1}. ${o.name}${o.urgent ? ' - URGENTE' : ''}`)
    if (o.note) lines.push(`   ${o.note}`)
  })
  lines.push('', first.authorName, '', ORDER_FOOTER)
  return lines
}

/** Linhas do PDF "Declaração de presença": nunca especialidade, serviço, relatório nem duração (BR-CLN-55). */
export function statementPdfLines(args: {
  clinicName: string
  patientName: string
  scheduledAt: string
  professionalName?: string
  issuedAt: string
}): string[] {
  const lines = [
    args.clinicName,
    'DECLARAÇÃO DE PRESENÇA',
    '',
    `Declara-se que o/a paciente ${args.patientName} compareceu à consulta marcada para ${when(args.scheduledAt)}.`,
  ]
  if (args.professionalName) lines.push(`Profissional: ${args.professionalName}`)
  lines.push('', `Emitida em ${when(args.issuedAt)}`, '', STATEMENT_FOOTER)
  return lines
}
