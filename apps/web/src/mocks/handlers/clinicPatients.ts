import { AppError } from '@/lib/errors'
import {
  CLINIC_PATIENT_NOTES_MAX,
  CLINIC_SEARCH_MIN,
  type ClinicBooking,
  type ClinicCalendar,
  type ClinicCalendarEntry,
  type ClinicPatient,
  type ClinicPatientInput,
  type ClinicPatientPage,
  type ClinicPatientPatch,
  type ClinicPatientRecord,
  type ClinicSearchResult,
  type ClinicSharedHistory,
} from '@/types/clinic'
import { LINK_CODE_ALPHABET } from '@/types/clinicConsent'
import { memberName } from '../access'
import { effectiveConsent, ensureBookingsConsent, linkMember, patientOfMember, toPublicPatient } from '../clinicPatients'
import { todayISO } from '@/lib/date'
import type { MockClinicAccountRecord } from '../data/clinicAccounts'
import type { MockClinicPatient } from '../data/clinicPatients'
import { addMonths } from '../data/clinicPatients'
import { db, newId } from '../db'
import { respond } from '../respond'
import { displayNameOf, toBooking, toClinicRecommendation, toExamBooking, toVisitBooking } from './clinicPortal'

/*
 * Pacientes da clínica, ficha, histórico partilhado, ligação por código, pesquisa e calendário
 * (M14 P, BR-CLN-17..24). `CLINIC_ADMIN` e `CLINIC_MANAGER` têm o mesmo acesso. Tudo é da clínica
 * da sessão: um id de outra clínica responde `NOT_FOUND`, como na API real. Nunca pesquisa a
 * base Vita (BR-CLN-22) e nunca devolve ids Vita (BR-CLN-17).
 */

function requireAccount(clinicAccountId: string): MockClinicAccountRecord {
  const account = db.clinicAccounts.find((a) => a.id === clinicAccountId)
  if (!account) throw new AppError('INVALID_CREDENTIALS')
  if (account.status !== 'ACTIVE') throw new AppError('ACCOUNT_SUSPENDED')
  return account
}

const PHONE_PATTERN = /^[+0-9 ()-]{5,30}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MAX_RECORD_ITEMS = 200
const MAX_SEARCH_ITEMS = 10
const MAX_CALENDAR_DAYS = 31

/** Minúsculas e sem acentos, para pesquisar por nome. */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()

const digits = (text: string) => text.replace(/\D/g, '')

function cleanQuery(q: unknown, required: boolean): string | undefined {
  if (q === undefined || q === null || q === '') {
    if (required) throw new AppError('VALIDATION_ERROR')
    return undefined
  }
  if (typeof q !== 'string') throw new AppError('VALIDATION_ERROR')
  const text = q.trim()
  if (text.length < CLINIC_SEARCH_MIN || text.length > 100) throw new AppError('VALIDATION_ERROR')
  return text
}

function matchesPatient(patient: MockClinicPatient, q: string): boolean {
  const needle = fold(q)
  if (fold(patient.name).includes(needle)) return true
  if (patient.email && patient.email.toLowerCase().includes(q.toLowerCase())) return true
  const qDigits = digits(q)
  return qDigits.length >= 3 && patient.phone !== null && digits(patient.phone).includes(qDigits)
}

const byName = (a: ClinicPatient, b: ClinicPatient) => a.name.localeCompare(b.name, 'pt-PT')

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string' || value.length > max) throw new AppError('VALIDATION_ERROR')
  return value.trim() || null
}

function cleanPatientFields(input: Partial<ClinicPatientInput>, now: Date) {
  const fields: Partial<Record<'name' | 'phone' | 'email' | 'birthDate' | 'notes', string | null>> = {}
  if (input.name !== undefined) {
    if (typeof input.name !== 'string') throw new AppError('VALIDATION_ERROR')
    const name = input.name.trim()
    if (name.length < 1 || name.length > 120) throw new AppError('VALIDATION_ERROR')
    fields.name = name
  }
  const phone = optionalText(input.phone, 30)
  if (phone !== undefined) {
    if (phone !== null && !PHONE_PATTERN.test(phone)) throw new AppError('VALIDATION_ERROR')
    fields.phone = phone
  }
  const email = optionalText(input.email, 254)
  if (email !== undefined) {
    if (email !== null && !EMAIL_PATTERN.test(email)) throw new AppError('VALIDATION_ERROR')
    fields.email = email
  }
  const birthDate = optionalText(input.birthDate, 10)
  if (birthDate !== undefined) {
    if (birthDate !== null && (!DATE_PATTERN.test(birthDate) || Number.isNaN(Date.parse(birthDate)) || birthDate > todayISO(now))) {
      throw new AppError('VALIDATION_ERROR')
    }
    fields.birthDate = birthDate
  }
  const notes = optionalText(input.notes, CLINIC_PATIENT_NOTES_MAX)
  if (notes !== undefined) fields.notes = notes
  return fields
}

function ownPatient(clinicId: string, id: string): MockClinicPatient {
  const patient = db.clinicPatients.find((p) => p.id === id && p.clinicId === clinicId)
  if (!patient) throw new AppError('NOT_FOUND')
  return patient
}

/** `GET /clinic-portal/patients?q&limit&cursor`: só o registo da própria clínica, ordem por nome. */
export function listClinicPatients(
  clinicAccountId: string,
  params: { q?: string; limit?: number; cursor?: string } = {},
  now: Date = new Date(),
) {
  return respond((): ClinicPatientPage => {
    const { clinicId } = requireAccount(clinicAccountId)
    const q = cleanQuery(params.q, false)
    const limit = params.limit ?? 25
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError('VALIDATION_ERROR')
    const offset = params.cursor === undefined ? 0 : Number(params.cursor)
    if (!Number.isInteger(offset) || offset < 0) throw new AppError('VALIDATION_ERROR')
    const all = db.clinicPatients
      .filter((p) => p.clinicId === clinicId && (!q || matchesPatient(p, q)))
      .map((p) => toPublicPatient(p, now))
      .sort(byName)
    const items = all.slice(offset, offset + limit)
    return { items, nextCursor: offset + limit < all.length ? String(offset + limit) : null }
  })
}

/** `POST /clinic-portal/patients`: paciente de balcão (origin=MANUAL, sem ligação Vita). */
export function createClinicPatient(clinicAccountId: string, input: ClinicPatientInput, now: Date = new Date()) {
  return respond((): ClinicPatient => {
    const { clinicId } = requireAccount(clinicAccountId)
    if (input.name === undefined) throw new AppError('VALIDATION_ERROR')
    const fields = cleanPatientFields(input, now)
    const stamp = now.toISOString()
    const patient: MockClinicPatient = {
      id: newId('cpt'),
      clinicId,
      name: fields.name ?? '',
      phone: fields.phone ?? null,
      email: fields.email ?? null,
      birthDate: fields.birthDate ?? null,
      notes: fields.notes ?? null,
      origin: 'MANUAL',
      vitaLink: null,
      createdAt: stamp,
      updatedAt: stamp,
    }
    db.clinicPatients.push(patient)
    return toPublicPatient(patient, now)
  })
}

/** `GET /clinic-portal/patients/{id}`. */
export function getClinicPatient(clinicAccountId: string, patientId: string, now: Date = new Date()) {
  return respond((): ClinicPatient => {
    const { clinicId } = requireAccount(clinicAccountId)
    return toPublicPatient(ownPatient(clinicId, patientId), now)
  })
}

/** `PATCH /clinic-portal/patients/{id}`: `origin` e `vitaLink` não são editáveis; `name` não aceita null. */
export function updateClinicPatient(
  clinicAccountId: string,
  patientId: string,
  patch: ClinicPatientPatch,
  now: Date = new Date(),
) {
  return respond((): ClinicPatient => {
    const { clinicId } = requireAccount(clinicAccountId)
    const patient = ownPatient(clinicId, patientId)
    if (Object.keys(patch).length === 0) throw new AppError('VALIDATION_ERROR')
    if (patch.name === null) throw new AppError('VALIDATION_ERROR')
    const fields = cleanPatientFields(patch, now)
    Object.assign(patient, fields)
    patient.updatedAt = now.toISOString()
    return toPublicPatient(patient, now)
  })
}

// --- Ficha e histórico partilhado ---

/** `GET /clinic-portal/patients/{id}/record`: só atividade da própria clínica (BR-CLN-03/17). */
export function getClinicPatientRecord(clinicAccountId: string, patientId: string, now: Date = new Date()) {
  return respond((): ClinicPatientRecord => {
    const { clinicId } = requireAccount(clinicAccountId)
    const patient = ownPatient(clinicId, patientId)
    const memberId = patient.memberId
    const newestFirst = (a: { scheduledAt: string }, b: { scheduledAt: string }) => b.scheduledAt.localeCompare(a.scheduledAt)
    const bookings: ClinicBooking[] = [
      ...(memberId
        ? db.appointments.filter((a) => a.clinicId === clinicId && a.memberId === memberId).map(toBooking)
        : []),
      ...db.clinicVisits.filter((v) => v.clinicId === clinicId && v.clinicPatientId === patient.id).map(toVisitBooking),
    ]
      .sort(newestFirst)
      .slice(0, MAX_RECORD_ITEMS)
    const examinations = memberId
      ? db.examinations
          .filter((e) => e.clinicId === clinicId && e.slotId && e.memberId === memberId)
          .map(toExamBooking)
          .sort(newestFirst)
          .slice(0, MAX_RECORD_ITEMS)
      : []
    const recommendations = memberId
      ? db.recommendations
          .filter((r) => r.clinicId === clinicId && r.memberId === memberId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, MAX_RECORD_ITEMS)
          .map(toClinicRecommendation)
      : []
    return { patient: toPublicPatient(patient, now), bookings, examinations, recommendations }
  })
}

/**
 * `GET /clinic-portal/patients/{id}/shared-history` (BR-CLN-21): só com ligação e consentimento
 * HISTORY válido; senão 200 com `active=false` e listas vazias (nunca 403). Medicação ativa e
 * exames dos últimos 24 meses e futuros, sem documentos nem notas.
 */
export function getClinicSharedHistory(clinicAccountId: string, patientId: string, now: Date = new Date()) {
  return respond((): ClinicSharedHistory => {
    const { clinicId } = requireAccount(clinicAccountId)
    const patient = ownPatient(clinicId, patientId)
    const consent = patient.memberId ? effectiveConsent(patient.memberId, clinicId, now) : undefined
    if (!patient.memberId || consent?.level !== 'HISTORY') {
      return { active: false, level: consent?.level ?? null, validUntil: null, medications: [], examinations: [] }
    }
    const memberId = patient.memberId
    const since = todayISO(new Date(addMonths(now.toISOString(), -24)))
    return {
      active: true,
      level: 'HISTORY',
      validUntil: consent.validUntil,
      medications: db.medicationPlans
        .filter((m) => m.memberId === memberId && m.status === 'ACTIVE')
        .map((m) => ({
          name: m.name,
          dosage: m.dosage,
          startAt: m.startAt,
          endAt: m.endAt ?? null,
          continuous: m.continuous,
        })),
      examinations: db.examinations
        .filter((e) => e.memberId === memberId && e.status !== 'CANCELLED' && e.examDate.slice(0, 10) >= since)
        .sort((a, b) => b.examDate.localeCompare(a.examDate))
        .map((e) => ({
          name: e.name,
          examDate: e.examDate.slice(0, 10),
          status: e.status as 'SCHEDULED' | 'COMPLETED',
          results: db.examResults
            .filter((r) => r.examinationId === e.id)
            .map((r) => ({
              parameter: r.parameter,
              valueNumeric: r.valueNumeric ?? null,
              valueText: r.valueText ?? null,
              unit: r.unit ?? null,
              referenceMin: r.referenceMin ?? null,
              referenceMax: r.referenceMax ?? null,
            })),
        })),
    }
  })
}

// --- Ligação por código (BR-CLN-20) ---

/** `POST /clinic-portal/patients/link`: consome o código; 404 idêntico para inválido/expirado/usado. */
export function linkClinicPatient(
  clinicAccountId: string,
  input: { code: string; clinicPatientId?: string },
  now: Date = new Date(),
) {
  return respond((): ClinicPatient => {
    const { clinicId } = requireAccount(clinicAccountId)
    const code = String(input.code ?? '').replace(/-/g, '').toUpperCase()
    if (code.length !== 8 || [...code].some((c) => !LINK_CODE_ALPHABET.includes(c))) throw new AppError('VALIDATION_ERROR')
    const entry = db.clinicLinkCodes.find((c) => c.code === code && !c.used && Date.parse(c.expiresAt) > now.getTime())
    if (!entry) throw new AppError('NOT_FOUND')
    const member = db.members.find((m) => m.id === entry.memberId && m.status === 'ACTIVE')
    if (!member) throw new AppError('NOT_FOUND')
    const target = input.clinicPatientId ? ownPatient(clinicId, input.clinicPatientId) : undefined
    const existing = patientOfMember(clinicId, member.id)

    if (target) {
      if (target.memberId && target.memberId !== member.id) throw new AppError('CONFLICT')
      if (existing && existing.id !== target.id) throw new AppError('CONFLICT')
    }
    entry.used = true
    if (target) {
      ensureBookingsConsent(member.id, clinicId)
      if (!target.memberId) {
        target.memberId = member.id
        target.linkVia = 'CODE'
        target.updatedAt = now.toISOString()
      }
      return toPublicPatient(target, now)
    }
    // Já ligado: idempotente (o código é consumido).
    return toPublicPatient(existing ?? linkMember(clinicId, member.id, displayNameOf(member.name), 'CODE', now), now)
  })
}

// --- Calendário e pesquisa global (BR-CLN-22/23) ---

const DEFAULT_APPOINTMENT_MINUTES = 30
const CALENDAR_APPOINTMENT_STATUSES = ['REQUESTED', 'SCHEDULED', 'COMPLETED', 'NO_SHOW']

/** Todas as marcações da clínica como entradas de calendário (consultas, exames e visitas manuais). */
function calendarEntries(clinicId: string): ClinicCalendarEntry[] {
  const slotOf = (id?: string) => db.slots.find((s) => s.id === id)
  const ends = (startsAt: string, minutes: number) => new Date(Date.parse(startsAt) + minutes * 60_000).toISOString()
  const professionalOf = (slot?: { professionalId?: string; professionalName?: string }) => ({
    professionalId: slot?.professionalId ?? null,
    professionalName: slot?.professionalName ?? null,
  })
  const entries: ClinicCalendarEntry[] = []
  for (const a of db.appointments) {
    if (a.clinicId !== clinicId || !CALENDAR_APPOINTMENT_STATUSES.includes(a.status)) continue
    const slot = slotOf(a.slotId)
    entries.push({
      id: a.id,
      source: 'VITA',
      kind: 'APPOINTMENT',
      status: a.status,
      startsAt: a.scheduledAt,
      endsAt: ends(a.scheduledAt, slot?.durationMinutes ?? DEFAULT_APPOINTMENT_MINUTES),
      ...professionalOf(slot),
      professionalName: a.professionalName ?? slot?.professionalName ?? null,
      specialty: a.specialty ?? null,
      patientName: memberName(a.memberId),
      clinicPatientId: patientOfMember(clinicId, a.memberId)?.id ?? null,
      slotId: a.slotId ?? null,
    })
  }
  for (const e of db.examinations) {
    if (e.clinicId !== clinicId || !e.slotId || (e.status !== 'SCHEDULED' && e.status !== 'COMPLETED')) continue
    const slot = slotOf(e.slotId)
    const startsAt = slot?.startsAt ?? e.examDate
    entries.push({
      id: e.id,
      source: 'VITA',
      kind: 'EXAM',
      status: e.status,
      startsAt,
      endsAt: ends(startsAt, slot?.durationMinutes ?? DEFAULT_APPOINTMENT_MINUTES),
      ...professionalOf(slot),
      specialty: e.name,
      patientName: memberName(e.memberId),
      clinicPatientId: patientOfMember(clinicId, e.memberId)?.id ?? null,
      slotId: e.slotId,
    })
  }
  for (const v of db.clinicVisits) {
    if (v.clinicId !== clinicId || v.status === 'CANCELLED') continue
    entries.push({
      id: v.id,
      source: 'MANUAL',
      kind: 'APPOINTMENT',
      status: v.status,
      startsAt: v.scheduledAt,
      endsAt: ends(v.scheduledAt, v.durationMinutes),
      professionalId: v.professionalId ?? null,
      professionalName: v.professionalName ?? null,
      specialty: v.specialty ?? null,
      patientName: db.clinicPatients.find((p) => p.id === v.clinicPatientId)?.name ?? '',
      clinicPatientId: v.clinicPatientId,
      slotId: v.slotId ?? null,
    })
  }
  return entries
}

/** `GET /clinic-portal/calendar?from&to&professionalId`: janela [from, to) de até 31 dias. */
export function getClinicCalendar(
  clinicAccountId: string,
  params: { from: string; to: string; professionalId?: string },
  now: Date = new Date(),
) {
  return respond((): ClinicCalendar => {
    const { clinicId } = requireAccount(clinicAccountId)
    const from = Date.parse(params.from)
    const to = Date.parse(params.to)
    if (Number.isNaN(from) || Number.isNaN(to) || to <= from || to - from > MAX_CALENDAR_DAYS * 86_400_000) {
      throw new AppError('VALIDATION_ERROR')
    }
    const { professionalId } = params
    if (professionalId && !db.professionals.some((p) => p.id === professionalId && p.clinicId === clinicId)) {
      throw new AppError('NOT_FOUND')
    }
    const inWindow = (iso: string) => Date.parse(iso) >= from && Date.parse(iso) < to
    const entries = calendarEntries(clinicId)
      .filter((e) => inWindow(e.startsAt) && (!professionalId || e.professionalId === professionalId))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    const freeSlots = db.slots
      .filter((s) => s.clinicId === clinicId && inWindow(s.startsAt) && Date.parse(s.startsAt) > now.getTime())
      .filter((s) => !professionalId || s.professionalId === professionalId)
      .map((s) => ({ slot: s, remaining: remainingOf(s) }))
      .filter(({ remaining }) => remaining >= 1)
      .sort((a, b) => a.slot.startsAt.localeCompare(b.slot.startsAt))
      .map(({ slot, remaining }) => ({
        slotId: slot.id,
        kind: slot.kind,
        startsAt: slot.startsAt,
        endsAt: new Date(Date.parse(slot.startsAt) + slot.durationMinutes * 60_000).toISOString(),
        professionalId: slot.professionalId ?? null,
        professionalName: slot.professionalName ?? null,
        specialty: slot.specialty,
        remaining,
      }))
    return { from: params.from, to: params.to, entries, freeSlots }
  })
}

function remainingOf(slot: (typeof db.slots)[number]): number {
  const booked =
    slot.kind === 'EXAM'
      ? db.examinations.filter((e) => e.slotId === slot.id && e.status === 'SCHEDULED').length
      : db.appointments.filter((a) => a.slotId === slot.id && (a.status === 'REQUESTED' || a.status === 'SCHEDULED'))
          .length + db.clinicVisits.filter((v) => v.slotId === slot.id && v.status === 'SCHEDULED').length
  return slot.capacity - booked
}

/** `GET /clinic-portal/search?q`: até 10 pacientes e 10 marcações da própria clínica; nunca a base Vita. */
export function clinicGlobalSearch(clinicAccountId: string, q: string, now: Date = new Date()) {
  return respond((): ClinicSearchResult => {
    const { clinicId } = requireAccount(clinicAccountId)
    const text = cleanQuery(q, true)!
    const needle = fold(text)
    const patients = db.clinicPatients
      .filter((p) => p.clinicId === clinicId && matchesPatient(p, text))
      .map((p) => toPublicPatient(p, now))
      .sort(byName)
      .slice(0, MAX_SEARCH_ITEMS)
    const matching = calendarEntries(clinicId).filter((e) =>
      [e.patientName, e.specialty, e.professionalName].some((field) => field && fold(field).includes(needle)),
    )
    // Futuras primeiro (mais próximas), depois as passadas (mais recentes).
    const upcoming = matching.filter((e) => Date.parse(e.startsAt) >= now.getTime()).sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    const past = matching.filter((e) => Date.parse(e.startsAt) < now.getTime()).sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    return { patients, bookings: [...upcoming, ...past].slice(0, MAX_SEARCH_ITEMS) }
  })
}
