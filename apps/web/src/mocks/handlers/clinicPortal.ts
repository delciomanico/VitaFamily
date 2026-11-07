import { AppError } from '@/lib/errors'
import type { Appointment } from '@/types/appointment'
import type {
  ClinicAccount,
  ClinicBooking,
  ClinicCompleteExamInput,
  ClinicCompleteInput,
  ClinicExamBooking,
  ClinicRequestDecision,
  ClinicSession,
  ClinicSlot,
  ClinicSlotView,
  PublishSlotsInput,
} from '@/types/clinic'
import type { ClinicRecommendation, RecommendationOrigin } from '@/types/recommendation'
import { RECOMMENDATION_MAX_LENGTH } from '@/types/recommendation'
import { MAX_SLOT_CAPACITY, SLOT_DURATIONS } from '@/types/clinic'
import type { SlotKind } from '@/types/clinic'
import type { Examination } from '@/types/examination'
import type { DocumentUpload } from '@/types/document'
import { memberName } from '../access'
import { raiseAlerts } from '../alertRules'
import { bookingOf, examBookingsOf, expireRequests, notifyResponse } from '../bookings'
import { overlappingSlot, timeOffAt } from '../clinicSchedule'
import { DEMO_PASSWORD } from '../data/users'
import type { MockClinicAccountRecord } from '../data/clinicAccounts'
import { db, newId } from '../db'
import { respond } from '../respond'
import { insertPrescription } from './medications'

/*
 * Portal da clínica parceira (`/clinic-portal/*`, D17/D18, ADR-020).
 *
 * As contas são `ClinicAccount` — espaço de identidade SEPARADO de `users`: outro login, outra
 * sessão, outro token. Nenhum handler aqui recebe `userId`, `familyId` ou `memberId`: a clínica
 * resolve-se sempre pela sessão (`clinicAccountId`), como na API real (authorization.md §6.1).
 *
 * A clínica só vê as marcações da própria clínica, com os dados mínimos (BR-CLN-03): nunca
 * família, membro, nem dados de saúde.
 */

/** Conta ativa da sessão; sem sessão válida → UNAUTHENTICATED (INVALID_CREDENTIALS na UI). */
function requireAccount(clinicAccountId: string): MockClinicAccountRecord {
  const account = db.clinicAccounts.find((a) => a.id === clinicAccountId)
  if (!account) throw new AppError('INVALID_CREDENTIALS')
  if (account.status !== 'ACTIVE') throw new AppError('ACCOUNT_SUSPENDED')
  return account
}

/** Só o Admin da clínica gere os Gestores da própria clínica (BR-CLN-05). */
function requireAdmin(clinicAccountId: string): MockClinicAccountRecord {
  const account = requireAccount(clinicAccountId)
  if (account.role !== 'CLINIC_ADMIN') throw new AppError('FORBIDDEN')
  return account
}

function clinicNameOf(clinicId: string): string | undefined {
  return db.clinics.find((c) => c.id === clinicId && c.type === 'PARTNER')?.name
}

function toSession(account: MockClinicAccountRecord): ClinicSession {
  return {
    clinicId: account.clinicId,
    role: account.role,
    email: account.email,
    clinicName: clinicNameOf(account.clinicId),
  }
}

function toPublicAccount({ id, clinicId, email, role, status }: MockClinicAccountRecord): ClinicAccount {
  return { id, clinicId, email, role, status }
}

/** `ClinicBooking`: mínimo necessário (BR-CLN-03). */
function toBooking(appointment: Appointment): ClinicBooking {
  return {
    id: appointment.id,
    status: appointment.status,
    scheduledAt: appointment.scheduledAt,
    specialty: appointment.specialty,
    professionalName: appointment.professionalName,
    patientName: memberName(appointment.memberId),
    notes: appointment.notes,
    responseNote: appointment.responseNote,
  }
}

/** Marcação desta clínica; de outra clínica → NOT_FOUND (sem enumeração). */
function findBooking(clinicId: string, id: string): Appointment {
  const appointment = db.appointments.find((a) => a.id === id && a.clinicId === clinicId)
  if (!appointment) throw new AppError('NOT_FOUND')
  return appointment
}

const byScheduledAt = (a: ClinicBooking, b: ClinicBooking) => a.scheduledAt.localeCompare(b.scheduledAt)

// --- Sessão (`/clinic-portal/auth/*`) ---

/**
 * Sessão do mock: em vez do par access/refresh token da API real, a UI guarda o
 * `clinicAccountId` (como a sessão de `User` no mock guarda o `userId`) e passa-o a cada handler.
 */
export interface MockClinicLoginResult extends ClinicSession {
  clinicAccountId: string
}

/** `POST /clinic-portal/auth/login`. */
export function clinicLogin(email: string, password: string) {
  return respond((): MockClinicLoginResult => {
    const account = db.clinicAccounts.find((a) => a.email === email.trim().toLowerCase())
    if (!account || account.password !== password) throw new AppError('INVALID_CREDENTIALS')
    if (account.status !== 'ACTIVE') throw new AppError('ACCOUNT_SUSPENDED')
    return { clinicAccountId: account.id, ...toSession(account) }
  })
}

/** `POST /clinic-portal/auth/refresh` (no mock: retoma a sessão guardada na aba). */
export function clinicRefresh(clinicAccountId: string) {
  return respond((): MockClinicLoginResult | null => {
    const account = db.clinicAccounts.find((a) => a.id === clinicAccountId && a.status === 'ACTIVE')
    return account ? { clinicAccountId: account.id, ...toSession(account) } : null
  })
}

// --- Hierarquia de staff (`/clinic-portal/staff`, BR-CLN-05) ---

/** `GET /clinic-portal/staff`: Gestores da própria clínica (nunca os de outra). */
export function listClinicStaff(clinicAccountId: string) {
  return respond((): ClinicAccount[] => {
    const admin = requireAdmin(clinicAccountId)
    return db.clinicAccounts
      .filter((a) => a.clinicId === admin.clinicId && a.role === 'CLINIC_MANAGER')
      .map(toPublicAccount)
      .sort((a, b) => a.email.localeCompare(b.email, 'pt-PT'))
  })
}

/**
 * `POST /clinic-portal/staff`: cria sempre um `CLINIC_MANAGER` (BR-CLN-05). Na API real a
 * palavra-passe inicial vai por e-mail; no modo demo é a palavra-passe de demonstração.
 */
export function createClinicStaff(clinicAccountId: string, email: string) {
  return respond((): ClinicAccount => {
    const admin = requireAdmin(clinicAccountId)
    const address = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new AppError('VALIDATION_ERROR')
    if (db.clinicAccounts.some((a) => a.email === address)) throw new AppError('VALIDATION_ERROR')
    const account: MockClinicAccountRecord = {
      id: newId('cac'),
      clinicId: admin.clinicId,
      email: address,
      password: DEMO_PASSWORD,
      role: 'CLINIC_MANAGER',
      status: 'ACTIVE',
    }
    db.clinicAccounts.push(account)
    return toPublicAccount(account)
  })
}

/** `DELETE /clinic-portal/staff/{clinicAccountId}`: só remove Gestores da própria clínica. */
export function removeClinicStaff(clinicAccountId: string, targetId: string) {
  return respond(() => {
    const admin = requireAdmin(clinicAccountId)
    const target = db.clinicAccounts.find(
      (a) => a.id === targetId && a.clinicId === admin.clinicId && a.role === 'CLINIC_MANAGER',
    )
    if (!target) throw new AppError('NOT_FOUND')
    db.clinicAccounts = db.clinicAccounts.filter((a) => a.id !== targetId)
  })
}

// --- Horários (`/clinic-portal/slots`, BR-CLN-04) ---

/** Ocupação e estado de um horário (BR-APT-11): consulta FREE|REQUESTED|SCHEDULED, exame FREE|PARTIAL|FULL. */
function toSlotView(slot: ClinicSlot): ClinicSlotView {
  if (slot.kind === 'EXAM') {
    const bookedCount = examBookingsOf(slot.id).length
    const remaining = slot.capacity - bookedCount
    return { ...slot, bookedCount, remaining, state: bookedCount === 0 ? 'FREE' : remaining === 0 ? 'FULL' : 'PARTIAL' }
  }
  const booking = bookingOf(slot.id)
  return {
    ...slot,
    bookedCount: booking ? 1 : 0,
    remaining: booking ? 0 : 1,
    state: booking?.status === 'SCHEDULED' ? 'SCHEDULED' : booking ? 'REQUESTED' : 'FREE',
  }
}

/** `GET /clinic-portal/slots?kind`: horários futuros da clínica, com a ocupação de cada um (UC-CLN-04). */
export function listOwnClinicSlots(clinicAccountId: string, kind?: SlotKind, now: Date = new Date()) {
  return respond((): ClinicSlotView[] => {
    const { clinicId } = requireAccount(clinicAccountId)
    expireRequests(now)
    return db.slots
      .filter(
        (slot) =>
          slot.clinicId === clinicId && (!kind || slot.kind === kind) && Date.parse(slot.startsAt) > now.getTime(),
      )
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.specialty.localeCompare(b.specialty))
      .map(toSlotView)
  })
}

/**
 * `POST /clinic-portal/slots`: publicar horários num dia; ignora horas passadas e duplicadas.
 * M14: com `professionalId`/`serviceTypeId` usa o catálogo (o serviço dá tipo, nome e duração) e
 * qualquer sobreposição do profissional ou bloqueio → `CONFLICT`, sem criar nada (BR-CLN-13/14).
 */
export function publishClinicSlots(clinicAccountId: string, input: PublishSlotsInput, now: Date = new Date()) {
  return respond((): ClinicSlot[] => {
    const { clinicId } = requireAccount(clinicAccountId)
    const professional = input.professionalId
      ? db.professionals.find((p) => p.id === input.professionalId && p.clinicId === clinicId)
      : undefined
    if (input.professionalId && !professional) throw new AppError('NOT_FOUND')
    const service = input.serviceTypeId
      ? db.services.find((s) => s.id === input.serviceTypeId && s.clinicId === clinicId)
      : undefined
    if (input.serviceTypeId && !service) throw new AppError('NOT_FOUND')
    if ((professional && !professional.active) || (service && !service.active)) throw new AppError('CONFLICT')
    if (service) {
      const differs =
        input.kind !== service.kind ||
        (input.durationMinutes !== undefined && input.durationMinutes !== service.durationMinutes) ||
        (input.specialty?.trim() && input.specialty.trim() !== service.name)
      if (differs) throw new AppError('VALIDATION_ERROR')
    }
    const specialty = service ? service.name : (input.specialty ?? '').trim()
    const durationMinutes = service ? service.durationMinutes : input.durationMinutes
    const professionalName = professional ? professional.name : input.professionalName?.trim() || undefined
    const capacity = input.capacity ?? 1
    if (!specialty || input.times.length === 0 || durationMinutes === undefined) throw new AppError('VALIDATION_ERROR')
    if (!(SLOT_DURATIONS as readonly number[]).includes(durationMinutes)) throw new AppError('VALIDATION_ERROR')
    // BR-APT-11: vagas 1–50, e só os horários de exame podem ter mais de uma.
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_SLOT_CAPACITY) throw new AppError('VALIDATION_ERROR')
    if (input.kind === 'APPOINTMENT' && capacity > 1) throw new AppError('VALIDATION_ERROR')

    const planned: Array<{ startsAt: Date; iso: string; duplicate: boolean }> = []
    for (const time of input.times) {
      const startsAt = new Date(`${input.date}T${time}`)
      if (Number.isNaN(startsAt.getTime())) throw new AppError('VALIDATION_ERROR')
      const iso = startsAt.toISOString()
      const duplicate = db.slots.some(
        (s) =>
          s.clinicId === clinicId &&
          s.kind === input.kind &&
          s.startsAt === iso &&
          s.professionalName === professionalName &&
          s.specialty === specialty &&
          (!professional || s.durationMinutes === durationMinutes),
      )
      if (startsAt.getTime() <= now.getTime()) continue
      if (professional && !duplicate) {
        // BR-CLN-13/14: nada é criado se alguma hora colidir.
        if (overlappingSlot(db, professional.id, iso, durationMinutes)) throw new AppError('CONFLICT')
        if (timeOffAt(db, professional.id, iso, durationMinutes)) throw new AppError('CONFLICT')
      }
      planned.push({ startsAt, iso, duplicate })
    }
    // Horas pedidas na mesma chamada não se podem sobrepor entre si (mesmo profissional).
    if (professional) {
      const fresh = planned.filter((p) => !p.duplicate).map((p) => p.startsAt.getTime()).sort((a, b) => a - b)
      for (let i = 1; i < fresh.length; i++) {
        if (fresh[i]! < fresh[i - 1]! + durationMinutes * 60_000) throw new AppError('CONFLICT')
      }
    }

    const created: ClinicSlot[] = []
    for (const { iso, duplicate } of planned) {
      if (duplicate) continue
      const slot: ClinicSlot = {
        id: newId('slot'),
        clinicId,
        kind: input.kind,
        capacity,
        specialty,
        professionalName,
        professionalId: professional?.id,
        serviceTypeId: service?.id,
        startsAt: iso,
        durationMinutes,
      }
      db.slots.push(slot)
      created.push(slot)
    }
    return created
  })
}

/** `PATCH /clinic-portal/slots/{slotId}`: altera as vagas de um horário de exame (BR-APT-11). */
export function updateClinicSlotCapacity(clinicAccountId: string, slotId: string, capacity: number) {
  return respond((): ClinicSlotView => {
    const { clinicId } = requireAccount(clinicAccountId)
    const slot = db.slots.find((s) => s.id === slotId && s.clinicId === clinicId)
    if (!slot) throw new AppError('NOT_FOUND')
    if (slot.kind !== 'EXAM' || !Number.isInteger(capacity) || capacity < 1 || capacity > MAX_SLOT_CAPACITY) {
      throw new AppError('VALIDATION_ERROR')
    }
    if (capacity < examBookingsOf(slot.id).length) throw new AppError('CONFLICT')
    slot.capacity = capacity
    return toSlotView(slot)
  })
}

/** `DELETE /clinic-portal/slots/{slotId}`: só horários sem marcação ativa (BR-CLN-04). */
export function removeClinicSlot(clinicAccountId: string, slotId: string) {
  return respond(() => {
    const { clinicId } = requireAccount(clinicAccountId)
    const slot = db.slots.find((s) => s.id === slotId && s.clinicId === clinicId)
    if (!slot) throw new AppError('NOT_FOUND')
    // Gerado por regra: não se remove individualmente (BR-CLN-12); usar bloqueio ou desativar a regra.
    if (slot.scheduleRuleId) throw new AppError('CONFLICT')
    if (bookingOf(slot.id) || examBookingsOf(slot.id).length > 0) throw new AppError('CONFLICT')
    db.slots = db.slots.filter((s) => s.id !== slotId)
  })
}

// --- Pedidos (`/clinic-portal/requests`, UC-CLN-05) ---

/** `GET /clinic-portal/requests`: só os pedidos por responder (`REQUESTED`). */
export function listClinicRequests(clinicAccountId: string, now: Date = new Date()) {
  return respond((): ClinicBooking[] => {
    const { clinicId } = requireAccount(clinicAccountId)
    expireRequests(now)
    return db.appointments
      .filter((a) => a.clinicId === clinicId && a.status === 'REQUESTED')
      .map(toBooking)
      .sort(byScheduledAt)
  })
}

/** `PUT /clinic-portal/requests/{appointmentId}`: confirmar (AGENDADA) ou recusar (RECUSADA). */
export function respondClinicRequest(
  clinicAccountId: string,
  appointmentId: string,
  decision: ClinicRequestDecision,
  note?: string,
  now: Date = new Date(),
) {
  return respond((): ClinicBooking => {
    const { clinicId } = requireAccount(clinicAccountId)
    expireRequests(now)
    const appointment = findBooking(clinicId, appointmentId)
    if (appointment.status !== 'REQUESTED') throw new AppError('CONFLICT')
    appointment.status = decision === 'CONFIRM' ? 'SCHEDULED' : 'REJECTED'
    // O motivo só é relevante na recusa (`ClinicRequestResponse`).
    if (decision === 'REJECT') appointment.responseNote = note?.trim() || undefined
    notifyResponse(appointment, now.toISOString())
    return toBooking(appointment)
  })
}

// --- Agenda (`/clinic-portal/agenda`, UC-CLN-06) ---

/** Estados que a agenda da clínica mostra (confirmadas e os seus desfechos). */
const AGENDA_STATUSES: Appointment['status'][] = ['SCHEDULED', 'COMPLETED', 'NO_SHOW', 'CANCELLED']

/** `GET /clinic-portal/agenda`: consultas confirmadas da própria clínica, por ordem cronológica. */
export function listClinicAgenda(clinicAccountId: string, now: Date = new Date()) {
  return respond((): ClinicBooking[] => {
    const { clinicId } = requireAccount(clinicAccountId)
    expireRequests(now)
    return db.appointments
      .filter((a) => a.clinicId === clinicId && AGENDA_STATUSES.includes(a.status))
      .map(toBooking)
      .sort(byScheduledAt)
  })
}

/** `PUT /clinic-portal/agenda/{appointmentId}/cancel`: futura e confirmada, com motivo obrigatório. */
export function cancelClinicAppointment(
  clinicAccountId: string,
  appointmentId: string,
  note: string,
  now: Date = new Date(),
) {
  return respond((): ClinicBooking => {
    const { clinicId } = requireAccount(clinicAccountId)
    const appointment = findBooking(clinicId, appointmentId)
    if (!note.trim()) throw new AppError('VALIDATION_ERROR')
    if (appointment.status !== 'SCHEDULED' || Date.parse(appointment.scheduledAt) <= now.getTime()) {
      throw new AppError('CONFLICT')
    }
    appointment.status = 'CANCELLED'
    appointment.responseNote = note.trim()
    notifyResponse(appointment, now.toISOString())
    return toBooking(appointment)
  })
}

/**
 * `PUT /clinic-portal/agenda/{appointmentId}/complete` (D18, BR-CLN-06/BR-RX-07): a consulta em
 * curso passa a REALIZADA, com o resultado e — opcionalmente — a receita, que nasce com
 * `issuedBy=CLINIC` e passa a aparecer no histórico do paciente.
 */
export function completeClinicAppointment(
  clinicAccountId: string,
  appointmentId: string,
  input: ClinicCompleteInput,
  now: Date = new Date(),
) {
  return respond((): ClinicBooking => {
    const { clinicId } = requireAccount(clinicAccountId)
    const appointment = findBooking(clinicId, appointmentId)
    // Só a consulta em curso: nunca completa duas vezes nem uma que não esteja confirmada (ST4).
    if (appointment.status !== 'SCHEDULED') throw new AppError('CONFLICT')

    if (input.prescription) {
      const { prescription } = input
      insertPrescription(
        appointment.familyId,
        {
          memberId: appointment.memberId,
          issuedOn: prescription.issuedOn,
          doctorName: prescription.doctorName,
          clinicName: clinicNameOf(clinicId),
          notes: prescription.notes,
          medications: prescription.medications.map((medication) => ({
            name: medication.name,
            dosage: medication.dosage,
            scheduleType: 'FIXED_TIMES',
            times: medication.times,
            continuous: medication.durationDays === undefined,
            durationDays: medication.durationDays,
            notes: medication.notes,
          })),
          documents: [],
        },
        now,
        { issuedBy: 'CLINIC', appointmentId },
      )
    }

    appointment.status = 'COMPLETED'
    const outcomeNote = input.outcomeNote?.trim()
    if (outcomeNote) {
      db.appointmentOutcomes.push({ appointmentId, outcomeNote, recordedAt: now.toISOString() })
    }
    return toBooking(appointment)
  })
}

// --- Agenda de exames (`/clinic-portal/exam-agenda`, ADR-023) ---

/** `ClinicExamBooking`: mínimo necessário (BR-CLN-03); nunca os valores dos resultados. */
function toExamBooking(exam: Examination): ClinicExamBooking {
  const slot = db.slots.find((s) => s.id === exam.slotId)
  const results = db.examResults.filter((r) => r.examinationId === exam.id)
  return {
    id: exam.id,
    status: exam.status,
    scheduledAt: slot?.startsAt ?? exam.examDate,
    examType: exam.name,
    patientName: memberName(exam.memberId),
    notes: exam.notes,
    responseNote: exam.responseNote,
    resultsCount: results.length,
    documents: db.documents
      .filter((d) => d.resourceType === 'EXAMINATION' && d.resourceId === exam.id && d.uploadedByClinic)
      .map((d) => ({ id: d.id, originalName: d.originalName, sizeBytes: d.sizeBytes, scanStatus: d.scanStatus ?? 'CLEAN' })),
  }
}

/** Exame desta clínica marcado num dos seus horários; de outra → NOT_FOUND (sem enumeração). */
function findExam(clinicId: string, id: string): Examination {
  const exam = db.examinations.find((e) => e.id === id && e.slotId && e.clinicId === clinicId)
  if (!exam) throw new AppError('NOT_FOUND')
  return exam
}

const byExamTime = (a: ClinicExamBooking, b: ClinicExamBooking) => a.scheduledAt.localeCompare(b.scheduledAt)

/** `GET /clinic-portal/exam-agenda`: exames marcados nos horários da clínica, por ordem cronológica. */
export function listClinicExamAgenda(clinicAccountId: string) {
  return respond((): ClinicExamBooking[] => {
    const { clinicId } = requireAccount(clinicAccountId)
    return db.examinations
      .filter((e) => e.slotId && e.clinicId === clinicId)
      .map(toExamBooking)
      .sort(byExamTime)
  })
}

/** `PUT /clinic-portal/exam-agenda/{id}/cancel`: exame SCHEDULED, com motivo; liberta a vaga. */
export function cancelClinicExam(clinicAccountId: string, examinationId: string, note: string) {
  return respond((): ClinicExamBooking => {
    const { clinicId } = requireAccount(clinicAccountId)
    const exam = findExam(clinicId, examinationId)
    if (!note.trim()) throw new AppError('VALIDATION_ERROR')
    if (exam.status !== 'SCHEDULED') throw new AppError('CONFLICT')
    exam.status = 'CANCELLED'
    exam.responseNote = note.trim()
    return toExamBooking(exam)
  })
}

/** `POST /clinic-portal/exam-agenda/{id}/documents`: PDF dos resultados (BR-CLN-08). */
export function uploadClinicExamDocument(clinicAccountId: string, examinationId: string, upload: DocumentUpload) {
  return respond((): ClinicExamBooking => {
    const { clinicId } = requireAccount(clinicAccountId)
    const exam = findExam(clinicId, examinationId)
    if (exam.status === 'CANCELLED' || upload.mimeType !== 'application/pdf') throw new AppError('VALIDATION_ERROR')
    db.documents.push({
      ...upload,
      id: newId('doc'),
      familyId: exam.familyId,
      memberId: exam.memberId,
      resourceType: 'EXAMINATION',
      resourceId: exam.id,
      createdAt: new Date().toISOString(),
      scanStatus: 'CLEAN',
      uploadedByClinic: true,
    })
    return toExamBooking(exam)
  })
}

/**
 * `PUT /clinic-portal/exam-agenda/{id}/complete` (BR-CLN-08, D11): grava os parâmetros e passa o
 * exame a COMPLETED; exige pelo menos um parâmetro ou um PDF já carregado. Sem interpretação.
 */
export function completeClinicExam(
  clinicAccountId: string,
  examinationId: string,
  input: ClinicCompleteExamInput,
  now: Date = new Date(),
) {
  return respond((): ClinicExamBooking => {
    const { clinicId } = requireAccount(clinicAccountId)
    const exam = findExam(clinicId, examinationId)
    if (exam.status !== 'SCHEDULED') throw new AppError('CONFLICT')
    const hasPdf = toExamBooking(exam).documents.length > 0
    if (input.results.length === 0 && !hasPdf) throw new AppError('VALIDATION_ERROR')
    for (const result of input.results) {
      const hasValue = result.valueNumeric !== undefined || Boolean(result.valueText?.trim())
      const { referenceMin: min, referenceMax: max } = result
      if (!result.parameter.trim() || !hasValue || (min !== undefined && max !== undefined && min > max)) {
        throw new AppError('VALIDATION_ERROR')
      }
      db.examResults.push({
        id: newId('res'),
        examinationId: exam.id,
        parameter: result.parameter.trim(),
        valueNumeric: result.valueNumeric,
        valueText: result.valueText?.trim() || undefined,
        unit: result.unit?.trim() || undefined,
        referenceMin: min,
        referenceMax: max,
        createdAt: now.toISOString(),
      })
    }
    exam.status = 'COMPLETED'
    exam.responseNote = input.resultNote?.trim() || exam.responseNote
    return toExamBooking(exam)
  })
}

// --- Recomendações (`/clinic-portal/recommendations`, BR-CLN-09) ---

/** `POST /clinic-portal/recommendations`: nota ligada a uma consulta (SCHEDULED/COMPLETED) ou exame (não cancelado) da clínica. */
export function createClinicRecommendation(
  clinicAccountId: string,
  input: RecommendationOrigin & { text: string },
  now: Date = new Date(),
) {
  return respond((): ClinicRecommendation => {
    const { clinicId } = requireAccount(clinicAccountId)
    const text = input.text.trim()
    const appointmentId = 'appointmentId' in input ? input.appointmentId : undefined
    const examinationId = 'examinationId' in input ? input.examinationId : undefined
    if (!text || text.length > RECOMMENDATION_MAX_LENGTH || Boolean(appointmentId) === Boolean(examinationId)) {
      throw new AppError('VALIDATION_ERROR')
    }
    const origin = appointmentId
      ? db.appointments.find((a) => a.id === appointmentId && a.clinicId === clinicId)
      : db.examinations.find((e) => e.id === examinationId && e.slotId && e.clinicId === clinicId)
    if (!origin) throw new AppError('NOT_FOUND')
    if (origin.status !== 'SCHEDULED' && origin.status !== 'COMPLETED') throw new AppError('CONFLICT')
    const recommendation = {
      id: newId('rec'),
      familyId: origin.familyId,
      memberId: origin.memberId,
      appointmentId,
      examinationId,
      clinicId,
      clinicName: origin.clinicName ?? clinicNameOf(clinicId) ?? 'Clínica',
      text,
      createdAt: now.toISOString(),
    }
    db.recommendations.push(recommendation)
    // O paciente é avisado, sem o texto (BR-CLN-09).
    raiseAlerts(db, [
      {
        familyId: origin.familyId,
        memberId: origin.memberId,
        type: 'RECOMMENDATION_ADDED',
        ruleKey: 'recommendation.added',
        sourceType: 'RECOMMENDATION',
        sourceId: recommendation.id,
        triggerAt: now.toISOString(),
        occurrence: recommendation.id,
      },
    ])
    return toClinicRecommendation(recommendation)
  })
}

function toClinicRecommendation(r: (typeof db.recommendations)[number]): ClinicRecommendation {
  return {
    id: r.id,
    appointmentId: r.appointmentId,
    examinationId: r.examinationId,
    patientName: memberName(r.memberId),
    text: r.text,
    createdAt: r.createdAt,
  }
}

/** `GET /clinic-portal/recommendations`: só as da própria clínica, mais recentes primeiro. */
export function listClinicRecommendations(clinicAccountId: string, origin?: Partial<RecommendationOrigin>) {
  return respond((): ClinicRecommendation[] => {
    const { clinicId } = requireAccount(clinicAccountId)
    const o = origin as { appointmentId?: string; examinationId?: string } | undefined
    return db.recommendations
      .filter(
        (r) =>
          r.clinicId === clinicId &&
          (!o?.appointmentId || r.appointmentId === o.appointmentId) &&
          (!o?.examinationId || r.examinationId === o.examinationId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toClinicRecommendation)
  })
}

// --- Marcação presencial (`/clinic-portal/patient-lookup` e `/walk-in-appointments`, ADR-024) ---

/** Primeiro nome + inicial do último apelido (“Maria S.”): o mínimo para o gestor confirmar a pessoa. */
function displayNameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined
  return last ? `${parts[0]} ${last[0]?.toUpperCase()}.` : (parts[0] ?? '')
}

/**
 * Resolve o utilizador pelo e-mail exato. Inexistente, suspenso ou sem membro próprio (o membro ligado à sua conta) dão a mesma
 * resposta (NOT_FOUND) para não revelar que contas existem (BR-CLN-10).
 */
function resolveWalkInPatient(email: string) {
  const address = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 254) throw new AppError('VALIDATION_ERROR')
  const user = db.users.find((u) => u.email.toLowerCase() === address && u.status === 'ACTIVE')
  const member = user && db.members.find((m) => m.userId === user.id && m.status === 'ACTIVE')
  if (!member) throw new AppError('NOT_FOUND')
  return member
}

/** `POST /clinic-portal/patient-lookup`: só o nome de apresentação, nunca ids. */
export function lookupClinicPatient(clinicAccountId: string, email: string) {
  return respond((): { displayName: string } => {
    requireAccount(clinicAccountId)
    return { displayName: displayNameOf(resolveWalkInPatient(email).name) }
  })
}

/** `POST /clinic-portal/walk-in-appointments`: consulta SCHEDULED num horário livre da própria clínica. */
export function createClinicWalkIn(
  clinicAccountId: string,
  input: { patientEmail: string; slotId: string; notes?: string },
  now: Date = new Date(),
) {
  return respond((): ClinicBooking => {
    const { clinicId } = requireAccount(clinicAccountId)
    expireRequests(now)
    const slot = db.slots.find((s) => s.id === input.slotId && s.clinicId === clinicId)
    if (!slot) throw new AppError('NOT_FOUND')
    const member = resolveWalkInPatient(input.patientEmail)
    if (slot.kind !== 'APPOINTMENT') throw new AppError('VALIDATION_ERROR')
    if (bookingOf(slot.id) || Date.parse(slot.startsAt) <= now.getTime()) throw new AppError('CONFLICT')
    const end = Date.parse(slot.startsAt) + slot.durationMinutes * 60_000
    const overlaps = db.appointments.some(
      (a) =>
        a.memberId === member.id &&
        a.status === 'SCHEDULED' &&
        Date.parse(a.scheduledAt) < end &&
        Date.parse(a.scheduledAt) + 30 * 60_000 > Date.parse(slot.startsAt),
    )
    if (overlaps) throw new AppError('CONFLICT')
    const clinic = db.clinics.find((c) => c.id === clinicId)
    const appointment: Appointment = {
      id: newId('apt'),
      familyId: member.familyId,
      memberId: member.id,
      status: 'SCHEDULED',
      scheduledAt: slot.startsAt,
      slotId: slot.id,
      specialty: slot.specialty,
      professionalName: slot.professionalName,
      clinicId,
      clinicName: clinic?.name,
      notes: input.notes?.trim() || undefined,
    }
    db.appointments.push(appointment)
    return toBooking(appointment)
  })
}
