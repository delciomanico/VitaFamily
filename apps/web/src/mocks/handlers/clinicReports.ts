import { AppError } from '@/lib/errors'
import { buildTextPdf } from '@/lib/pdf'
import type { Appointment } from '@/types/appointment'
import type {
  ClinicExamResultsDraft,
  ClinicExamResultsDraftInput,
  ConsultationReport,
  ConsultationReportInput,
  FamilyConsultationReport,
} from '@/types/clinicReport'
import { ADDENDA_MAX, ADDENDUM_MAX_LENGTH } from '@/types/clinicReport'
import type { Examination } from '@/types/examination'
import { memberAccess } from '../access'
import {
  cleanSections,
  reportOfBooking,
  reportPdfLines,
  REPORT_FOOTER,
  validateExamDraft,
} from '../clinicReports'
import { ownsAppointment, ownsExam, ownsVisit, recordClinicAudit, requireAnyAccount } from '../clinicRoles'
import type { MockClinicAccountRecord } from '../data/clinicAccounts'
import { db, newId, type MockConsultationReport } from '../db'
import { respond, respondBlob } from '../respond'

/*
 * Relatório da consulta e rascunho de resultados (M15, ADR-027). Permissões decididas aqui, nunca
 * só na UI (BR-CLN-44): o Médico escreve só nas marcações do seu profissional; Admin e Gestor leem.
 * Mock nunca substitui os testes de autorização/imutabilidade do backend.
 */

type ReportBooking =
  | { kind: 'APPOINTMENT'; id: string; appointment: Appointment; status: string; scheduledAt: string; specialty?: string; patientName: string }
  | { kind: 'VISIT'; id: string; status: string; scheduledAt: string; specialty?: string; patientName: string }

const nameOf = (memberId: string) => db.members.find((m) => m.id === memberId)?.name ?? ''

/** Marcação da própria clínica (consulta Vita ou visita manual); do Médico, só as suas; senão NOT_FOUND. */
function findBooking(account: MockClinicAccountRecord, id: string): ReportBooking {
  const visit = db.clinicVisits.find((v) => v.id === id && v.clinicId === account.clinicId)
  if (visit) {
    if (!ownsVisit(account, visit)) throw new AppError('NOT_FOUND')
    return {
      kind: 'VISIT',
      id: visit.id,
      status: visit.status,
      scheduledAt: visit.scheduledAt,
      specialty: visit.specialty,
      patientName: db.clinicPatients.find((p) => p.id === visit.clinicPatientId)?.name ?? '',
    }
  }
  const appointment = db.appointments.find((a) => a.id === id && a.clinicId === account.clinicId)
  if (!appointment || !ownsAppointment(account, appointment)) throw new AppError('NOT_FOUND')
  return {
    kind: 'APPOINTMENT',
    id: appointment.id,
    appointment,
    status: appointment.status,
    scheduledAt: appointment.scheduledAt,
    specialty: appointment.specialty,
    patientName: nameOf(appointment.memberId),
  }
}

function requireDoctor(account: MockClinicAccountRecord) {
  if (account.role !== 'CLINIC_DOCTOR') throw new AppError('FORBIDDEN')
}

const authorNameOf = (account: MockClinicAccountRecord) =>
  db.professionals.find((p) => p.id === account.professionalId)?.name ?? ''

const clinicNameOf = (clinicId: string) => db.clinics.find((c) => c.id === clinicId)?.name ?? ''

/** Visão da clínica: nunca expõe `clinicId`, ids Vita nem o retrato interno. */
function toClinicView(report: MockConsultationReport): ConsultationReport {
  const { clinicId: _c, familyId: _f, memberId: _m, clinicName: _n, ...view } = report
  return view
}

/** Cria/atualiza o rascunho (última escrita ganha). Só marcações SCHEDULED/COMPLETED e sem FINAL. */
function upsertDraft(
  account: MockClinicAccountRecord,
  booking: ReportBooking,
  input: ConsultationReportInput,
  now: Date,
): MockConsultationReport {
  if (booking.status !== 'SCHEDULED' && booking.status !== 'COMPLETED') throw new AppError('CONFLICT')
  const existing = reportOfBooking(account.clinicId, booking.id)
  if (existing?.status === 'FINAL') throw new AppError('CONFLICT')
  const sections = cleanSections(input)
  const sharedWithPatient = booking.kind === 'VISIT' ? false : (input.sharedWithPatient ?? existing?.sharedWithPatient ?? true)
  const stamp = now.toISOString()
  const base = {
    reason: sections.reason,
    findings: sections.findings,
    impression: sections.impression,
    plan: sections.plan,
    sharedWithPatient,
    updatedAt: stamp,
  }
  if (existing) {
    Object.assign(existing, base)
    return existing
  }
  const report: MockConsultationReport = {
    id: newId('rep'),
    bookingKind: booking.kind,
    bookingId: booking.id,
    status: 'DRAFT',
    ...base,
    patientName: booking.patientName,
    consultationAt: booking.scheduledAt,
    specialty: booking.specialty,
    authorName: authorNameOf(account),
    authorAccountId: account.id,
    addenda: [],
    createdAt: stamp,
    clinicId: account.clinicId,
    ...(booking.kind === 'APPOINTMENT'
      ? { familyId: booking.appointment.familyId, memberId: booking.appointment.memberId }
      : {}),
  }
  db.consultationReports.push(report)
  return report
}

function markFinal(report: MockConsultationReport, now: Date) {
  const stamp = now.toISOString()
  report.status = 'FINAL'
  report.finalizedAt = stamp
  report.updatedAt = stamp
  report.clinicName = clinicNameOf(report.clinicId)
}

/**
 * `complete` com `report` (BR-CLN-42/44): valida tudo **antes** de a conclusão mexer em dados e
 * devolve a função que grava e finaliza (mesma operação). Admin/Gestor ⇒ FORBIDDEN, nada se grava.
 */
export function prepareReportOnComplete(
  account: MockClinicAccountRecord,
  bookingId: string,
  input: ConsultationReportInput,
  now: Date,
): () => void {
  requireDoctor(account)
  const booking = findBooking(account, bookingId)
  if (reportOfBooking(account.clinicId, booking.id)?.status === 'FINAL') throw new AppError('CONFLICT')
  cleanSections(input)
  return () => {
    const report = upsertDraft(account, booking, input, now)
    markFinal(report, now)
    recordClinicAudit(account, 'CONSULT_REPORT_SAVED', 'ConsultationReport', report.id)
    recordClinicAudit(account, 'CONSULT_REPORT_FINALIZED', 'ConsultationReport', report.id)
  }
}

// --- Clínica: `/clinic-portal/agenda/{id}/report*` ---

export function getClinicConsultationReport(clinicAccountId: string, bookingId: string) {
  return respond((): ConsultationReport => {
    const account = requireAnyAccount(clinicAccountId)
    const booking = findBooking(account, bookingId)
    const report = reportOfBooking(account.clinicId, booking.id)
    if (!report) throw new AppError('NOT_FOUND')
    recordClinicAudit(account, 'CONSULT_REPORT_VIEWED', 'ConsultationReport', report.id)
    return toClinicView(report)
  })
}

export function saveClinicConsultationReport(
  clinicAccountId: string,
  bookingId: string,
  input: ConsultationReportInput,
  now: Date = new Date(),
) {
  return respond((): ConsultationReport => {
    const account = requireAnyAccount(clinicAccountId)
    requireDoctor(account)
    const report = upsertDraft(account, findBooking(account, bookingId), input, now)
    recordClinicAudit(account, 'CONSULT_REPORT_SAVED', 'ConsultationReport', report.id)
    return toClinicView(report)
  })
}

export function finalizeClinicConsultationReport(clinicAccountId: string, bookingId: string, now: Date = new Date()) {
  return respond((): ConsultationReport => {
    const account = requireAnyAccount(clinicAccountId)
    requireDoctor(account)
    const booking = findBooking(account, bookingId)
    const report = reportOfBooking(account.clinicId, booking.id)
    if (!report) throw new AppError('NOT_FOUND')
    if (report.status === 'DRAFT') {
      markFinal(report, now)
      recordClinicAudit(account, 'CONSULT_REPORT_FINALIZED', 'ConsultationReport', report.id)
    }
    return toClinicView(report)
  })
}

export function addClinicConsultationReportAddendum(
  clinicAccountId: string,
  bookingId: string,
  text: string,
  now: Date = new Date(),
) {
  return respond((): ConsultationReport => {
    const account = requireAnyAccount(clinicAccountId)
    requireDoctor(account)
    const booking = findBooking(account, bookingId)
    const report = reportOfBooking(account.clinicId, booking.id)
    if (!report) throw new AppError('NOT_FOUND')
    if (report.status !== 'FINAL') throw new AppError('CONFLICT')
    const clean = text.replace(/\r\n/g, '\n').trim()
    if (!clean || clean.length > ADDENDUM_MAX_LENGTH) throw new AppError('VALIDATION_ERROR')
    if (report.addenda.length >= ADDENDA_MAX) throw new AppError('LIMIT_EXCEEDED')
    report.addenda.push({ id: newId('add'), text: clean, authorName: authorNameOf(account), createdAt: now.toISOString() })
    report.updatedAt = now.toISOString()
    recordClinicAudit(account, 'CONSULT_REPORT_AMENDED', 'ConsultationReport', report.id)
    return toClinicView(report)
  })
}

export function getClinicConsultationReportPdf(clinicAccountId: string, bookingId: string) {
  return respondBlob((): Blob => {
    const account = requireAnyAccount(clinicAccountId)
    const booking = findBooking(account, bookingId)
    const report = reportOfBooking(account.clinicId, booking.id)
    if (!report) throw new AppError('NOT_FOUND')
    recordClinicAudit(account, 'CONSULT_REPORT_VIEWED', 'ConsultationReport', report.id)
    return buildTextPdf(reportPdfLines(report, report.clinicName ?? clinicNameOf(report.clinicId)))
  })
}

// --- Família: `/families/{f}/members/{m}/appointments/{id}/report*` (BR-CLN-45) ---

function familyReport(familyId: string, userId: string, memberId: string, appointmentId: string): MockConsultationReport {
  // Titular ou tutor; `DEPENDENT_SELF`/`OTHER` (mesmo com partilha) ⇒ FORBIDDEN.
  if (!memberAccess(familyId, userId, memberId).manage) throw new AppError('FORBIDDEN')
  const appointment = db.appointments.find((a) => a.id === appointmentId && a.familyId === familyId && a.memberId === memberId)
  const report = appointment?.clinicId ? reportOfBooking(appointment.clinicId, appointment.id) : undefined
  if (!report || report.status !== 'FINAL' || !report.sharedWithPatient || report.bookingKind !== 'APPOINTMENT') {
    throw new AppError('NOT_FOUND')
  }
  return report
}

export function getFamilyConsultationReport(familyId: string, userId: string, memberId: string, appointmentId: string) {
  return respond((): FamilyConsultationReport => {
    const report = familyReport(familyId, userId, memberId, appointmentId)
    return {
      appointmentId,
      clinicName: report.clinicName ?? clinicNameOf(report.clinicId),
      consultationAt: report.consultationAt,
      specialty: report.specialty,
      authorName: report.authorName,
      reason: report.reason,
      findings: report.findings,
      impression: report.impression,
      plan: report.plan,
      finalizedAt: report.finalizedAt ?? report.updatedAt,
      // Sem ids da clínica nem da conta autora.
      addenda: report.addenda.map(({ id, text, authorName, createdAt }) => ({ id, text, authorName, createdAt })),
      notice: REPORT_FOOTER,
    }
  })
}

export function getFamilyConsultationReportPdf(familyId: string, userId: string, memberId: string, appointmentId: string) {
  return respondBlob((): Blob => {
    const report = familyReport(familyId, userId, memberId, appointmentId)
    return buildTextPdf(reportPdfLines(report, report.clinicName ?? clinicNameOf(report.clinicId)))
  })
}

// --- Exames: rascunho de resultados e laudo (M15 T) ---

function findOwnExam(account: MockClinicAccountRecord, id: string): Examination {
  const exam = db.examinations.find((e) => e.id === id && e.slotId && e.clinicId === account.clinicId)
  if (!exam || !ownsExam(account, exam)) throw new AppError('NOT_FOUND')
  return exam
}

const draftOf = (examinationId: string) => db.examResultDrafts.find((d) => d.examinationId === examinationId)

function toDraftView(draft: NonNullable<ReturnType<typeof draftOf>>): ClinicExamResultsDraft {
  const { clinicId: _c, ...view } = draft
  return view
}

export function getClinicExamResultsDraft(clinicAccountId: string, examinationId: string) {
  return respond((): ClinicExamResultsDraft => {
    const exam = findOwnExam(requireAnyAccount(clinicAccountId), examinationId)
    const draft = draftOf(exam.id)
    if (!draft) throw new AppError('NOT_FOUND')
    return toDraftView(draft)
  })
}

export function saveClinicExamResultsDraft(
  clinicAccountId: string,
  examinationId: string,
  input: ClinicExamResultsDraftInput,
  now: Date = new Date(),
) {
  return respond((): ClinicExamResultsDraft => {
    const account = requireAnyAccount(clinicAccountId)
    const exam = findOwnExam(account, examinationId)
    if (exam.status !== 'SCHEDULED') throw new AppError('CONFLICT')
    validateExamDraft(input)
    const next = {
      examinationId: exam.id,
      status: 'DRAFT' as const,
      results: structuredClone(input.results),
      resultNote: input.resultNote?.trim() || undefined,
      updatedAt: now.toISOString(),
      clinicId: account.clinicId,
    }
    const current = draftOf(exam.id)
    if (current) Object.assign(current, next)
    else db.examResultDrafts.push(next)
    recordClinicAudit(account, 'EXAM_RESULTS_DRAFT_SAVED', 'Examination', exam.id)
    return toDraftView(draftOf(exam.id)!)
  })
}

export function discardClinicExamResultsDraft(clinicAccountId: string, examinationId: string) {
  return respond((): void => {
    const account = requireAnyAccount(clinicAccountId)
    const exam = findOwnExam(account, examinationId)
    db.examResultDrafts = db.examResultDrafts.filter((d) => d.examinationId !== exam.id)
    recordClinicAudit(account, 'EXAM_RESULTS_DRAFT_DISCARDED', 'Examination', exam.id)
  })
}

/** Laudo gerado pelo sistema (BR-CLN-48/49): só com o exame COMPLETED e o documento ainda existente. */
export function getClinicExamReportPdf(clinicAccountId: string, examinationId: string) {
  return respondBlob((): Blob => {
    const account = requireAnyAccount(clinicAccountId)
    const exam = findOwnExam(account, examinationId)
    const snapshot = db.examReportSnapshots.find((s) => s.examinationId === exam.id)
    if (exam.status !== 'COMPLETED' || !snapshot || !db.documents.some((d) => d.id === snapshot.documentId)) {
      throw new AppError('NOT_FOUND')
    }
    recordClinicAudit(account, 'EXAM_REPORT_DOWNLOAD', 'Examination', exam.id)
    return buildTextPdf(snapshot.lines)
  })
}
