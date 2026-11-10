import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import type { Appointment } from '@/types/appointment'
import { db, resetDb } from '../db'
import { at } from '../time'
import { isOutOfReference } from '../clinicReports'
import * as apt from './appointments'
import * as reports from './clinicReports'
import * as portal from './clinicPortal'
import * as exams from './examinations'

const ADMIN = 'cac_horizonte_admin'
const MANAGER = 'cac_horizonte_rececao'
const DOCTOR = 'cac_horizonte_medica' // profissional pro_ana
const OTHER_CLINIC = 'cac_vidaplena_admin'
const FAMILY = 'fam_monarca'
const MONARCA = 'usr_monarca'
const NOW = new Date(2026, 10, 5, 12, 0)

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

let seq = 0
/** Consulta Vita em curso da Clínica Horizonte, de um dado profissional. */
function booking(patch: Partial<Appointment> = {}, professionalId = 'pro_ana'): Appointment {
  seq += 1
  db.slots.push({
    id: `slot_rep_${seq}`,
    clinicId: 'cln_horizonte',
    kind: 'APPOINTMENT',
    capacity: 1,
    specialty: 'Cardiologia',
    professionalId,
    professionalName: 'Dr.ª Ana Costa',
    startsAt: at(0, '10:00', NOW),
    durationMinutes: 30,
  })
  const appointment: Appointment = {
    id: `apt_rep_${seq}`,
    familyId: FAMILY,
    memberId: 'mem_maria',
    scheduledAt: at(0, '10:00', NOW),
    status: 'SCHEDULED',
    slotId: `slot_rep_${seq}`,
    specialty: 'Cardiologia',
    clinicId: 'cln_horizonte',
    clinicName: 'Clínica Horizonte',
    ...patch,
  }
  db.appointments.push(appointment)
  return appointment
}

const text = { reason: 'Dor lombar há 3 dias.', findings: 'Sem défice neurológico.', impression: 'Lombalgia.', plan: 'Repouso.' }
const pdfText = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.readAsText(blob)
  })

beforeEach(() => {
  resetDb(NOW)
  db.clinicAccounts.push({
    id: OTHER_CLINIC,
    clinicId: 'cln_vidaplena',
    email: 'admin@vidaplena.pt',
    password: 'x',
    role: 'CLINIC_ADMIN',
    status: 'ACTIVE',
  })
})

describe('relatório da consulta: autoria e papéis (BR-CLN-44)', () => {
  it('só o Médico escreve; Admin e Gestor recebem FORBIDDEN e nada se grava', async () => {
    const a = booking()
    expect(await code(reports.saveClinicConsultationReport(ADMIN, a.id, text, NOW))).toBe('FORBIDDEN')
    expect(await code(reports.saveClinicConsultationReport(MANAGER, a.id, text, NOW))).toBe('FORBIDDEN')
    expect(await code(reports.finalizeClinicConsultationReport(MANAGER, a.id, NOW))).toBe('FORBIDDEN')
    expect(await code(reports.addClinicConsultationReportAddendum(ADMIN, a.id, 'x', NOW))).toBe('FORBIDDEN')
    expect(db.consultationReports).toHaveLength(0)
    expect(await code(reports.saveClinicConsultationReport(DOCTOR, a.id, text, NOW))).toBe('OK')
  })

  it('o Médico só escreve nas marcações do seu profissional; sem profissional ou outra clínica ⇒ NOT_FOUND', async () => {
    const mine = booking()
    const theirs = booking({}, 'pro_ines')
    const noPro = booking({ slotId: undefined })
    expect(await code(reports.saveClinicConsultationReport(DOCTOR, mine.id, text, NOW))).toBe('OK')
    expect(await code(reports.saveClinicConsultationReport(DOCTOR, theirs.id, text, NOW))).toBe('NOT_FOUND')
    expect(await code(reports.saveClinicConsultationReport(DOCTOR, noPro.id, text, NOW))).toBe('NOT_FOUND')
    await reports.saveClinicConsultationReport(DOCTOR, mine.id, text, NOW)
    expect(await code(reports.getClinicConsultationReport(OTHER_CLINIC, mine.id))).toBe('NOT_FOUND')
  })

  it('Admin e Gestor leem o relatório e o PDF de qualquer marcação da clínica; o Médico lê só os seus', async () => {
    const a = booking({}, 'pro_ines')
    const b = booking()
    await reports.saveClinicConsultationReport(DOCTOR, b.id, text, NOW)
    expect(await code(reports.getClinicConsultationReport(MANAGER, b.id))).toBe('OK')
    expect(await code(reports.getClinicConsultationReportPdf(ADMIN, b.id))).toBe('OK')
    expect(await code(reports.getClinicConsultationReport(DOCTOR, a.id))).toBe('NOT_FOUND')
    expect(await code(reports.getClinicConsultationReport(MANAGER, a.id))).toBe('NOT_FOUND') // ainda sem relatório
  })
})

describe('relatório da consulta: rascunho, finalização e adendas (BR-CLN-41..43)', () => {
  it('valida limites, secções vazias e caracteres de controlo', async () => {
    const a = booking()
    const save = (input: object) => code(reports.saveClinicConsultationReport(DOCTOR, a.id, input, NOW))
    expect(await save({})).toBe('VALIDATION_ERROR')
    expect(await save({ reason: '   ' })).toBe('VALIDATION_ERROR')
    expect(await save({ reason: 'x'.repeat(301) })).toBe('VALIDATION_ERROR')
    expect(await save({ impression: 'x'.repeat(501) })).toBe('VALIDATION_ERROR')
    expect(await save({ plan: 'x'.repeat(1501) })).toBe('VALIDATION_ERROR')
    expect(await save({ findings: 'a\u0007b' })).toBe('VALIDATION_ERROR')
    expect(await save({ findings: 'linha 1\nlinha 2' })).toBe('OK')
  })

  it('rascunho editável; FINAL é imutável e idempotente; adenda só em FINAL', async () => {
    const a = booking()
    expect(await code(reports.addClinicConsultationReportAddendum(DOCTOR, a.id, 'x', NOW))).toBe('NOT_FOUND')
    await reports.saveClinicConsultationReport(DOCTOR, a.id, { reason: 'Primeira' }, NOW)
    await reports.saveClinicConsultationReport(DOCTOR, a.id, { reason: 'Segunda' }, NOW)
    expect((await reports.getClinicConsultationReport(DOCTOR, a.id)).reason).toBe('Segunda')
    expect(await code(reports.addClinicConsultationReportAddendum(DOCTOR, a.id, 'x', NOW))).toBe('CONFLICT')

    const final = await reports.finalizeClinicConsultationReport(DOCTOR, a.id, NOW)
    expect(final).toMatchObject({ status: 'FINAL', authorName: 'Dr.ª Ana Costa' })
    expect(await code(reports.finalizeClinicConsultationReport(DOCTOR, a.id, NOW))).toBe('OK')
    expect(await code(reports.saveClinicConsultationReport(DOCTOR, a.id, { reason: 'Outra' }, NOW))).toBe('CONFLICT')

    const amended = await reports.addClinicConsultationReportAddendum(DOCTOR, a.id, 'Resultado recebido.', NOW)
    expect(amended.addenda).toHaveLength(1)
    expect(await code(reports.addClinicConsultationReportAddendum(DOCTOR, a.id, '', NOW))).toBe('VALIDATION_ERROR')
    expect(await code(reports.addClinicConsultationReportAddendum(DOCTOR, a.id, 'x'.repeat(1501), NOW))).toBe('VALIDATION_ERROR')
  })

  it('no máximo 20 adendas', async () => {
    const a = booking()
    await reports.saveClinicConsultationReport(DOCTOR, a.id, text, NOW)
    await reports.finalizeClinicConsultationReport(DOCTOR, a.id, NOW)
    for (let i = 0; i < 20; i += 1) await reports.addClinicConsultationReportAddendum(DOCTOR, a.id, `n${i}`, NOW)
    expect(await code(reports.addClinicConsultationReportAddendum(DOCTOR, a.id, 'n21', NOW))).toBe('LIMIT_EXCEEDED')
  })

  it('o PDF do rascunho leva a marca de rascunho; o FINAL leva a assinatura e o rodapé', async () => {
    const a = booking()
    await reports.saveClinicConsultationReport(DOCTOR, a.id, { reason: 'Dor' }, NOW)
    const draft = await reports.getClinicConsultationReportPdf(MANAGER, a.id)
    expect(draft.type).toBe('application/pdf')
    expect(await pdfText(draft)).toContain('RASCUNHO')
    await reports.finalizeClinicConsultationReport(DOCTOR, a.id, NOW)
    const final = await pdfText(await reports.getClinicConsultationReportPdf(MANAGER, a.id))
    expect(final).not.toContain('RASCUNHO')
    expect(final).toContain('Dr.ª Ana Costa'.replace('ª', '\\252'))
    expect(final).toContain('Documento n')
  })

  it('visita manual nunca é partilhada com o paciente', async () => {
    const visit = db.clinicVisits[0]!
    visit.status = 'SCHEDULED'
    visit.professionalId = 'pro_ana'
    const saved = await reports.saveClinicConsultationReport(DOCTOR, visit.id, { ...text, sharedWithPatient: true }, NOW)
    expect(saved).toMatchObject({ bookingKind: 'VISIT', sharedWithPatient: false })
  })
})

describe('concluir com relatório (BR-CLN-42)', () => {
  it('Médico: grava e finaliza ao concluir, e a lista indica reportStatus', async () => {
    const a = booking()
    const done = await portal.completeClinicAppointment(DOCTOR, a.id, { outcomeNote: 'ok', report: text }, NOW)
    expect(done.status).toBe('COMPLETED')
    expect(done.reportStatus).toBe('FINAL')
    expect(db.consultationReports[0]).toMatchObject({ status: 'FINAL', sharedWithPatient: true })
    const agenda = await portal.listClinicAgenda(MANAGER, NOW)
    expect(agenda.find((b) => b.id === a.id)?.reportStatus).toBe('FINAL')
  })

  it('Admin/Gestor com report ⇒ FORBIDDEN e a consulta continua em curso; sem report conclui', async () => {
    const a = booking()
    expect(await code(portal.completeClinicAppointment(MANAGER, a.id, { report: text }, NOW))).toBe('FORBIDDEN')
    expect(db.appointments.find((x) => x.id === a.id)?.status).toBe('SCHEDULED')
    expect(db.consultationReports).toHaveLength(0)
    expect(await code(portal.completeClinicAppointment(MANAGER, a.id, { outcomeNote: 'ok' }, NOW))).toBe('OK')
  })

  it('relatório inválido ⇒ nada muda (consulta continua SCHEDULED)', async () => {
    const a = booking()
    expect(await code(portal.completeClinicAppointment(DOCTOR, a.id, { report: { reason: '' } }, NOW))).toBe('VALIDATION_ERROR')
    expect(db.appointments.find((x) => x.id === a.id)?.status).toBe('SCHEDULED')
  })

  it('sem report não toca no rascunho; depois de COMPLETED ainda se pode finalizar', async () => {
    const a = booking()
    await reports.saveClinicConsultationReport(DOCTOR, a.id, text, NOW)
    await portal.completeClinicAppointment(DOCTOR, a.id, { outcomeNote: 'ok' }, NOW)
    expect((await reports.getClinicConsultationReport(DOCTOR, a.id)).status).toBe('DRAFT')
    expect((await reports.finalizeClinicConsultationReport(DOCTOR, a.id, NOW)).status).toBe('FINAL')
  })

  it('marcação cancelada não aceita relatório', async () => {
    const a = booking({ status: 'CANCELLED' })
    expect(await code(reports.saveClinicConsultationReport(DOCTOR, a.id, text, NOW))).toBe('CONFLICT')
  })
})

describe('leitura pelo paciente (BR-CLN-45)', () => {
  const finalOf = async (patch: object = {}) => {
    const a = booking()
    await reports.saveClinicConsultationReport(DOCTOR, a.id, { ...text, ...patch }, NOW)
    await reports.finalizeClinicConsultationReport(DOCTOR, a.id, NOW)
    return a
  }

  it('titular/tutor leem o FINAL partilhado, sem ids da clínica; reportAvailable acende', async () => {
    const a = await finalOf()
    await reports.addClinicConsultationReportAddendum(DOCTOR, a.id, 'Adenda.', NOW)
    const view = await reports.getFamilyConsultationReport(FAMILY, MONARCA, 'mem_maria', a.id)
    expect(view).toMatchObject({ clinicName: 'Clínica Horizonte', authorName: 'Dr.ª Ana Costa', impression: 'Lombalgia.' })
    expect(view.addenda).toHaveLength(1)
    expect(JSON.stringify(view)).not.toMatch(/cln_|cac_|clinicId|authorAccountId/)
    expect((await apt.getAppointment(FAMILY, MONARCA, a.id)).appointment.reportAvailable).toBe(true)
    expect((await reports.getFamilyConsultationReportPdf(FAMILY, MONARCA, 'mem_maria', a.id)).type).toBe('application/pdf')
  })

  it('rascunho, não partilhado ou outra família ⇒ NOT_FOUND (cartão não aparece)', async () => {
    const draft = booking()
    await reports.saveClinicConsultationReport(DOCTOR, draft.id, text, NOW)
    const hidden = await finalOf({ sharedWithPatient: false })
    expect(await code(reports.getFamilyConsultationReport(FAMILY, MONARCA, 'mem_maria', draft.id))).toBe('NOT_FOUND')
    expect(await code(reports.getFamilyConsultationReport(FAMILY, MONARCA, 'mem_maria', hidden.id))).toBe('NOT_FOUND')
    expect((await apt.getAppointment(FAMILY, MONARCA, hidden.id)).appointment.reportAvailable).toBeUndefined()
  })

  it('outro membro adulto (mesmo com partilha) ⇒ FORBIDDEN', async () => {
    const a = await finalOf()
    expect(await code(reports.getFamilyConsultationReport(FAMILY, 'usr_ana', 'mem_maria', a.id))).toBe('FORBIDDEN')
  })
})

describe('exames: rascunho de resultados e laudo (BR-CLN-47..49)', () => {
  const results = [
    { parameter: 'Hemoglobina', valueNumeric: 11.2, unit: 'g/dL', referenceMin: 12, referenceMax: 16 },
    { parameter: 'Glicemia', valueNumeric: 90, unit: 'mg/dL', referenceMin: 70, referenceMax: 90 },
    { parameter: 'Urina', valueText: 'Negativo' },
  ]

  let hour = 7
  async function scheduledExam() {
    hour += 1
    const [slot] = await portal.publishClinicSlots(
      ADMIN,
      { kind: 'EXAM', capacity: 1, date: '2026-11-06', times: [`${String(hour).padStart(2, '0')}:00`], specialty: 'Análises', durationMinutes: 30 },
      NOW,
    )
    return exams.createExamination(
      FAMILY,
      MONARCA,
      { memberId: 'mem_maria', name: 'Análises', examDate: '2026-11-06', slotId: slot!.id, results: [], documents: [] },
      NOW,
    )
  }

  it('o rascunho guarda-se sem concluir, não cria resultados e é descartável', async () => {
    const exam = await scheduledExam()
    expect(await code(reports.getClinicExamResultsDraft(ADMIN, exam.id))).toBe('NOT_FOUND')
    expect(await code(reports.saveClinicExamResultsDraft(ADMIN, exam.id, { results: [] }, NOW))).toBe('VALIDATION_ERROR')
    await reports.saveClinicExamResultsDraft(ADMIN, exam.id, { results }, NOW)
    expect((await reports.getClinicExamResultsDraft(MANAGER, exam.id)).results).toHaveLength(3)
    expect(db.examResults.filter((r) => r.examinationId === exam.id)).toHaveLength(0)
    expect((await portal.listClinicExamAgenda(ADMIN)).find((e) => e.id === exam.id)?.hasResultsDraft).toBe(true)
    await reports.discardClinicExamResultsDraft(ADMIN, exam.id)
    await reports.discardClinicExamResultsDraft(ADMIN, exam.id) // idempotente
    expect(await code(reports.getClinicExamResultsDraft(ADMIN, exam.id))).toBe('NOT_FOUND')
  })

  it('concluir sem results usa o rascunho (apaga-o) e gera o laudo como documento do exame', async () => {
    const exam = await scheduledExam()
    await reports.saveClinicExamResultsDraft(ADMIN, exam.id, { results, resultNote: 'Jejum' }, NOW)
    const done = await portal.completeClinicExam(ADMIN, exam.id, {}, NOW)
    expect(done).toMatchObject({ status: 'COMPLETED', resultsCount: 3, reportAvailable: true, hasResultsDraft: false })
    const doc = db.documents.find((d) => d.resourceId === exam.id && d.generatedBySystem)
    expect(doc).toMatchObject({ uploadedByClinic: true, scanStatus: 'CLEAN', mimeType: 'application/pdf' })
    // O laudo não conta como PDF carregado pela clínica.
    expect(done.documents).toHaveLength(0)
    // A família vê-o na lista de documentos do exame, rotulado pelo sistema.
    expect((await exams.getExamination(FAMILY, MONARCA, exam.id)).documents.some((d) => d.generatedBySystem)).toBe(true)
  })

  it('o realce "Fora da referência" existe só no PDF (estrito) e nunca no JSON', async () => {
    const exam = await scheduledExam()
    const done = await portal.completeClinicExam(ADMIN, exam.id, { results }, NOW)
    const body = await pdfText(await reports.getClinicExamReportPdf(ADMIN, exam.id))
    expect(body).toContain('Fora da refer')
    expect(body.match(/Fora da refer/g)).toHaveLength(2) // uma linha (11,2 < 12) + o texto fixo; 90 = limite é dentro
    expect(body).toContain('n\\343o constitui interpreta') // texto fixo de não interpretação
    expect(JSON.stringify(done)).not.toMatch(/Fora da|outOfRange|abnormal/i)
    expect(JSON.stringify(await exams.getExamination(FAMILY, MONARCA, exam.id))).not.toMatch(/Fora da/)
    expect(db.alerts.filter((a) => a.sourceId === exam.id && /RESULT/.test(a.type)).every((a) => !/Fora/.test(JSON.stringify(a)))).toBe(true)
  })

  it('generateReport=false ou só texto/PDF carregado ⇒ sem laudo; laudo apagado ⇒ NOT_FOUND', async () => {
    const off = await scheduledExam()
    await portal.completeClinicExam(ADMIN, off.id, { results, generateReport: false }, NOW)
    expect(await code(reports.getClinicExamReportPdf(ADMIN, off.id))).toBe('NOT_FOUND')

    const on = await scheduledExam()
    await portal.completeClinicExam(ADMIN, on.id, { results }, NOW)
    expect(await code(reports.getClinicExamReportPdf(ADMIN, on.id))).toBe('OK')
    db.documents = db.documents.filter((d) => !(d.resourceId === on.id && d.generatedBySystem))
    expect(await code(reports.getClinicExamReportPdf(ADMIN, on.id))).toBe('NOT_FOUND')
    expect(await code(reports.getClinicExamReportPdf(OTHER_CLINIC, on.id))).toBe('NOT_FOUND')
  })

  it('exame cancelado perde o rascunho; concluído não aceita rascunho', async () => {
    const a = await scheduledExam()
    await reports.saveClinicExamResultsDraft(ADMIN, a.id, { results }, NOW)
    await portal.cancelClinicExam(ADMIN, a.id, 'Avaria')
    expect(db.examResultDrafts).toHaveLength(0)
    const b = await scheduledExam()
    await portal.completeClinicExam(ADMIN, b.id, { results }, NOW)
    expect(await code(reports.saveClinicExamResultsDraft(ADMIN, b.id, { results }, NOW))).toBe('CONFLICT')
  })
})

describe('isOutOfReference', () => {
  it.each([
    [{ valueNumeric: 11.9, referenceMin: 12 }, true],
    [{ valueNumeric: 12, referenceMin: 12 }, false],
    [{ valueNumeric: 16.1, referenceMax: 16 }, true],
    [{ valueNumeric: 16, referenceMax: 16 }, false],
    [{ valueNumeric: 5 }, false],
    [{}, false],
  ])('%j => %s', (input, expected) => {
    expect(isOutOfReference(input)).toBe(expected)
  })
})
