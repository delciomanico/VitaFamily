import { AppError } from '@/lib/errors'
import {
  MAX_CLINIC_PROFESSIONALS,
  MAX_CLINIC_RULES,
  MAX_CLINIC_SERVICES,
  MAX_SLOT_CAPACITY,
  SLOT_DURATIONS,
  type ClinicProfessional,
  type ClinicProfessionalInput,
  type ClinicProfessionalPatch,
  type ClinicScheduleRule,
  type ClinicScheduleRuleInput,
  type ClinicScheduleRulePatch,
  type ClinicServiceType,
  type ClinicServiceTypeInput,
  type ClinicServiceTypePatch,
  type ClinicTimeOff,
  type ClinicTimeOffInput,
  type ScheduleGeneration,
  type ScheduleRuleResult,
  type SlotKind,
  type TimeOffResult,
} from '@/types/clinic'
import { CLINIC_CURRENCY } from '../data/clinicCatalog'
import type { MockClinicAccountRecord } from '../data/clinicAccounts'
import { bookedCountOf, generateRule, generateRules, rulesOverlap } from '../clinicSchedule'
import { db, newId } from '../db'
import { respond } from '../respond'

/*
 * Catálogo da clínica, regras de horário e bloqueios (M14 a1/a2, BR-CLN-11..16).
 * `CLINIC_ADMIN` e `CLINIC_MANAGER` podem ler e escrever. Tudo é da clínica da sessão: um id de
 * outra clínica responde `NOT_FOUND`, como na API real.
 */

function requireAccount(clinicAccountId: string): MockClinicAccountRecord {
  const account = db.clinicAccounts.find((a) => a.id === clinicAccountId)
  if (!account) throw new AppError('INVALID_CREDENTIALS')
  if (account.status !== 'ACTIVE') throw new AppError('ACCOUNT_SUSPENDED')
  return account
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MAX_PRICE_MINOR = 100_000_000_000
const MAX_TIME_OFF_MS = 366 * 86_400_000

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

const publicProfessional = ({ id, name, specialty, active }: ClinicProfessional): ClinicProfessional => ({
  id,
  name,
  specialty,
  active,
})

const publicService = ({ id, name, kind, durationMinutes, priceMinor, currency, active }: ClinicServiceType) => ({
  id,
  name,
  kind,
  durationMinutes,
  priceMinor,
  currency,
  active,
})

function cleanName(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('VALIDATION_ERROR')
  const name = value.trim()
  if (name.length < 1 || name.length > 120) throw new AppError('VALIDATION_ERROR')
  return name
}

function cleanSpecialty(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new AppError('VALIDATION_ERROR')
  const specialty = value.trim()
  if (specialty.length > 80) throw new AppError('VALIDATION_ERROR')
  return specialty || undefined
}

function cleanPrice(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_PRICE_MINOR) {
    throw new AppError('VALIDATION_ERROR')
  }
  return value
}

function cleanDuration(value: unknown): number {
  if (typeof value !== 'number' || !(SLOT_DURATIONS as readonly number[]).includes(value)) {
    throw new AppError('VALIDATION_ERROR')
  }
  return value
}

// --- Profissionais (BR-CLN-11) ---

const ownProfessional = (clinicId: string, id: string) => {
  const professional = db.professionals.find((p) => p.id === id && p.clinicId === clinicId)
  if (!professional) throw new AppError('NOT_FOUND')
  return professional
}

const ownService = (clinicId: string, id: string) => {
  const service = db.services.find((s) => s.id === id && s.clinicId === clinicId)
  if (!service) throw new AppError('NOT_FOUND')
  return service
}

const ownRule = (clinicId: string, id: string) => {
  const rule = db.scheduleRules.find((r) => r.id === id && r.clinicId === clinicId)
  if (!rule) throw new AppError('NOT_FOUND')
  return rule
}

/** Reconcilia (e gera) todas as regras de um conjunto — usado ao desativar profissional/serviço. */
function reconcile(clinicId: string, filter: (rule: ClinicScheduleRule) => boolean, now: Date) {
  generateRules(
    db,
    db.scheduleRules.filter((r) => r.clinicId === clinicId && filter(r)),
    now,
  )
}

/** `GET /clinic-portal/professionals?active`. */
export function listClinicProfessionals(clinicAccountId: string, filter: { active?: boolean } = {}) {
  return respond((): ClinicProfessional[] => {
    const { clinicId } = requireAccount(clinicAccountId)
    return db.professionals
      .filter((p) => p.clinicId === clinicId && (filter.active === undefined || p.active === filter.active))
      .map(publicProfessional)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-PT'))
  })
}

/** `POST /clinic-portal/professionals`. */
export function createClinicProfessional(clinicAccountId: string, input: ClinicProfessionalInput) {
  return respond((): ClinicProfessional => {
    const { clinicId } = requireAccount(clinicAccountId)
    const name = cleanName(input.name)
    const specialty = cleanSpecialty(input.specialty)
    const own = db.professionals.filter((p) => p.clinicId === clinicId)
    if (own.length >= MAX_CLINIC_PROFESSIONALS) throw new AppError('CONFLICT')
    if (own.some((p) => p.active && sameName(p.name, name))) throw new AppError('CONFLICT')
    const professional = { id: newId('pro'), clinicId, name, specialty, active: true }
    db.professionals.push(professional)
    return publicProfessional(professional)
  })
}

/** `PATCH /clinic-portal/professionals/{id}`: editar ou desativar/reativar (BR-CLN-15). */
export function updateClinicProfessional(
  clinicAccountId: string,
  professionalId: string,
  patch: ClinicProfessionalPatch,
  now: Date = new Date(),
) {
  return respond((): ClinicProfessional => {
    const { clinicId } = requireAccount(clinicAccountId)
    const professional = ownProfessional(clinicId, professionalId)
    if (Object.keys(patch).length === 0) throw new AppError('VALIDATION_ERROR')
    const name = patch.name !== undefined ? cleanName(patch.name) : professional.name
    const specialty = 'specialty' in patch ? cleanSpecialty(patch.specialty) : professional.specialty
    const active = patch.active ?? professional.active
    if (active && db.professionals.some((p) => p.id !== professional.id && p.clinicId === clinicId && p.active && sameName(p.name, name))) {
      throw new AppError('CONFLICT')
    }
    const deactivated = professional.active && !active
    professional.name = name
    professional.specialty = specialty
    professional.active = active
    if (deactivated) reconcile(clinicId, (r) => r.professionalId === professional.id, now)
    return publicProfessional(professional)
  })
}

// --- Serviços (BR-CLN-11/12) ---

/** `GET /clinic-portal/services?active&kind`. */
export function listClinicServices(clinicAccountId: string, filter: { active?: boolean; kind?: SlotKind } = {}) {
  return respond((): ClinicServiceType[] => {
    const { clinicId } = requireAccount(clinicAccountId)
    return db.services
      .filter(
        (s) =>
          s.clinicId === clinicId &&
          (filter.active === undefined || s.active === filter.active) &&
          (!filter.kind || s.kind === filter.kind),
      )
      .map(publicService)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-PT'))
  })
}

/** `POST /clinic-portal/services`. */
export function createClinicService(clinicAccountId: string, input: ClinicServiceTypeInput) {
  return respond((): ClinicServiceType => {
    const { clinicId } = requireAccount(clinicAccountId)
    const name = cleanName(input.name)
    if (input.kind !== 'APPOINTMENT' && input.kind !== 'EXAM') throw new AppError('VALIDATION_ERROR')
    const durationMinutes = cleanDuration(input.durationMinutes)
    const priceMinor = cleanPrice(input.priceMinor)
    const own = db.services.filter((s) => s.clinicId === clinicId)
    if (own.length >= MAX_CLINIC_SERVICES) throw new AppError('CONFLICT')
    if (own.some((s) => s.active && s.kind === input.kind && sameName(s.name, name))) throw new AppError('CONFLICT')
    const service = { id: newId('svc'), clinicId, name, kind: input.kind, durationMinutes, priceMinor, currency: CLINIC_CURRENCY, active: true }
    db.services.push(service)
    return publicService(service)
  })
}

/** `PATCH /clinic-portal/services/{id}`: `kind` é imutável (BR-CLN-12). */
export function updateClinicService(
  clinicAccountId: string,
  serviceTypeId: string,
  patch: ClinicServiceTypePatch,
  now: Date = new Date(),
) {
  return respond((): ClinicServiceType => {
    const { clinicId } = requireAccount(clinicAccountId)
    const service = ownService(clinicId, serviceTypeId)
    if (Object.keys(patch).length === 0 || 'kind' in patch) throw new AppError('VALIDATION_ERROR')
    const name = patch.name !== undefined ? cleanName(patch.name) : service.name
    const durationMinutes = patch.durationMinutes !== undefined ? cleanDuration(patch.durationMinutes) : service.durationMinutes
    const priceMinor = 'priceMinor' in patch ? cleanPrice(patch.priceMinor) : service.priceMinor
    const active = patch.active ?? service.active
    if (
      active &&
      db.services.some((s) => s.id !== service.id && s.clinicId === clinicId && s.active && s.kind === service.kind && sameName(s.name, name))
    ) {
      throw new AppError('CONFLICT')
    }
    const deactivated = service.active && !active
    service.name = name
    service.durationMinutes = durationMinutes
    service.priceMinor = priceMinor
    service.active = active
    if (deactivated) reconcile(clinicId, (r) => r.serviceTypeId === service.id, now)
    return publicService(service)
  })
}

// --- Regras de horário (BR-CLN-12/13/15) ---

const publicRule = ({ clinicId: _clinicId, ...rule }: ClinicScheduleRule & { clinicId: string }): ClinicScheduleRule => ({
  ...rule,
  weekdays: [...rule.weekdays].sort((a, b) => a - b),
})

function cleanWeekdays(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 7 ||
    new Set(value).size !== value.length ||
    value.some((d) => !Number.isInteger(d) || d < 1 || d > 7)
  ) {
    throw new AppError('VALIDATION_ERROR')
  }
  return [...(value as number[])].sort((a, b) => a - b)
}

function cleanTime(value: unknown): string {
  if (typeof value !== 'string' || !TIME_PATTERN.test(value)) throw new AppError('VALIDATION_ERROR')
  return value
}

function cleanDay(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) throw new AppError('VALIDATION_ERROR')
  return value
}

/** Valida a forma final da regra contra o serviço e as outras regras ativas do profissional. */
function checkRule(
  rule: ClinicScheduleRule & { clinicId: string },
  service: ClinicServiceType,
  ignoreId?: string,
) {
  const [sh = 0, sm = 0] = rule.startTime.split(':').map(Number)
  const [eh = 0, em = 0] = rule.endTime.split(':').map(Number)
  const length = eh * 60 + em - (sh * 60 + sm)
  if (length < service.durationMinutes) throw new AppError('VALIDATION_ERROR')
  if (rule.validFrom && rule.validUntil && rule.validUntil < rule.validFrom) throw new AppError('VALIDATION_ERROR')
  if (!Number.isInteger(rule.capacity) || rule.capacity < 1 || rule.capacity > MAX_SLOT_CAPACITY) {
    throw new AppError('VALIDATION_ERROR')
  }
  if (rule.capacity > 1 && service.kind !== 'EXAM') throw new AppError('VALIDATION_ERROR')
  if (
    rule.active &&
    db.scheduleRules.some(
      (r) => r.id !== ignoreId && r.clinicId === rule.clinicId && r.active && r.professionalId === rule.professionalId && rulesOverlap(r, rule),
    )
  ) {
    throw new AppError('CONFLICT')
  }
}

/** `GET /clinic-portal/schedule-rules?professionalId&active`. */
export function listClinicScheduleRules(
  clinicAccountId: string,
  filter: { professionalId?: string; active?: boolean } = {},
) {
  return respond((): ClinicScheduleRule[] => {
    const { clinicId } = requireAccount(clinicAccountId)
    return db.scheduleRules
      .filter(
        (r) =>
          r.clinicId === clinicId &&
          (!filter.professionalId || r.professionalId === filter.professionalId) &&
          (filter.active === undefined || r.active === filter.active),
      )
      .map(publicRule)
  })
}

/** `POST /clinic-portal/schedule-rules`: cria a regra e gera já os horários da janela de 8 semanas. */
export function createClinicScheduleRule(clinicAccountId: string, input: ClinicScheduleRuleInput, now: Date = new Date()) {
  return respond((): ScheduleRuleResult => {
    const { clinicId } = requireAccount(clinicAccountId)
    const professional = ownProfessional(clinicId, input.professionalId)
    const service = ownService(clinicId, input.serviceTypeId)
    const rule: ClinicScheduleRule & { clinicId: string } = {
      id: newId('rul'),
      clinicId,
      professionalId: professional.id,
      serviceTypeId: service.id,
      weekdays: cleanWeekdays(input.weekdays),
      startTime: cleanTime(input.startTime),
      endTime: cleanTime(input.endTime),
      validFrom: cleanDay(input.validFrom),
      validUntil: cleanDay(input.validUntil),
      capacity: input.capacity ?? 1,
      active: true,
    }
    if (!professional.active || !service.active) throw new AppError('CONFLICT')
    if (db.scheduleRules.filter((r) => r.clinicId === clinicId).length >= MAX_CLINIC_RULES) throw new AppError('CONFLICT')
    checkRule(rule, service)
    db.scheduleRules.push(rule)
    return { rule: publicRule(rule), generation: generateRule(db, rule.id, now) }
  })
}

/** `PATCH /clinic-portal/schedule-rules/{id}`: profissional e serviço são imutáveis. */
export function updateClinicScheduleRule(
  clinicAccountId: string,
  ruleId: string,
  patch: ClinicScheduleRulePatch,
  now: Date = new Date(),
) {
  return respond((): ScheduleRuleResult => {
    const { clinicId } = requireAccount(clinicAccountId)
    const rule = ownRule(clinicId, ruleId)
    if (Object.keys(patch).length === 0 || 'professionalId' in patch || 'serviceTypeId' in patch) {
      throw new AppError('VALIDATION_ERROR')
    }
    const service = ownService(clinicId, rule.serviceTypeId)
    const professional = ownProfessional(clinicId, rule.professionalId)
    const next: ClinicScheduleRule & { clinicId: string } = {
      ...rule,
      weekdays: patch.weekdays !== undefined ? cleanWeekdays(patch.weekdays) : rule.weekdays,
      startTime: patch.startTime !== undefined ? cleanTime(patch.startTime) : rule.startTime,
      endTime: patch.endTime !== undefined ? cleanTime(patch.endTime) : rule.endTime,
      validFrom: 'validFrom' in patch ? cleanDay(patch.validFrom) : rule.validFrom,
      validUntil: 'validUntil' in patch ? cleanDay(patch.validUntil) : rule.validUntil,
      capacity: patch.capacity ?? rule.capacity,
      active: patch.active ?? rule.active,
    }
    if (next.active && !rule.active && (!professional.active || !service.active)) throw new AppError('CONFLICT')
    checkRule(next, service, rule.id)
    Object.assign(rule, next)
    return { rule: publicRule(rule), generation: generateRule(db, rule.id, now) }
  })
}

/** `POST /clinic-portal/schedule-rules/{id}/regenerate`: idempotente. */
export function regenerateClinicScheduleRule(clinicAccountId: string, ruleId: string, now: Date = new Date()) {
  return respond((): ScheduleRuleResult => {
    const { clinicId } = requireAccount(clinicAccountId)
    const rule = ownRule(clinicId, ruleId)
    return { rule: publicRule(rule), generation: generateRule(db, rule.id, now) }
  })
}

// --- Bloqueios / férias (BR-CLN-14) ---

/** Horários do profissional que intersectam o intervalo. */
const slotsInRange = (clinicId: string, professionalId: string, startsAt: number, endsAt: number) =>
  db.slots.filter((s) => {
    if (s.clinicId !== clinicId || s.professionalId !== professionalId) return false
    const start = Date.parse(s.startsAt)
    return start < endsAt && startsAt < start + s.durationMinutes * 60_000
  })

function toTimeOff({ clinicId, ...timeOff }: ClinicTimeOff & { clinicId: string }): ClinicTimeOff {
  const booked = slotsInRange(clinicId, timeOff.professionalId, Date.parse(timeOff.startsAt), Date.parse(timeOff.endsAt))
    .filter((s) => bookedCountOf(db, s) > 0).length
  return { ...timeOff, bookedSlotCount: booked }
}

/** `GET /clinic-portal/time-off?professionalId&from&to`; por omissão só os que terminam depois de agora. */
export function listClinicTimeOff(
  clinicAccountId: string,
  filter: { professionalId?: string; from?: string; to?: string } = {},
  now: Date = new Date(),
) {
  return respond((): ClinicTimeOff[] => {
    const { clinicId } = requireAccount(clinicAccountId)
    const from = filter.from ? Date.parse(filter.from) : now.getTime()
    const to = filter.to ? Date.parse(filter.to) : Infinity
    return db.timeOffs
      .filter(
        (t) =>
          t.clinicId === clinicId &&
          (!filter.professionalId || t.professionalId === filter.professionalId) &&
          Date.parse(t.endsAt) > from &&
          Date.parse(t.startsAt) < to,
      )
      .map(toTimeOff)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  })
}

/** `POST /clinic-portal/time-off`: remove os livres, lista os marcados (sem dados do paciente). */
export function createClinicTimeOff(clinicAccountId: string, input: ClinicTimeOffInput, now: Date = new Date()) {
  return respond((): TimeOffResult => {
    const { clinicId } = requireAccount(clinicAccountId)
    const professional = ownProfessional(clinicId, input.professionalId)
    const start = Date.parse(input.startsAt)
    const end = Date.parse(input.endsAt)
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start || end - start > MAX_TIME_OFF_MS || end <= now.getTime()) {
      throw new AppError('VALIDATION_ERROR')
    }
    const reason = input.reason?.trim() || undefined
    if (reason && reason.length > 200) throw new AppError('VALIDATION_ERROR')
    const timeOff = { id: newId('off'), clinicId, professionalId: professional.id, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), reason, bookedSlotCount: 0 }
    db.timeOffs.push(timeOff)

    const affected = slotsInRange(clinicId, professional.id, start, end).filter((s) => Date.parse(s.startsAt) > now.getTime())
    const bookedSlots: TimeOffResult['bookedSlots'] = []
    let removedSlots = 0
    for (const slot of affected) {
      const bookedCount = bookedCountOf(db, slot)
      if (bookedCount > 0) {
        bookedSlots.push({ slotId: slot.id, kind: slot.kind, startsAt: slot.startsAt, durationMinutes: slot.durationMinutes, bookedCount })
      } else {
        db.slots = db.slots.filter((s) => s.id !== slot.id)
        removedSlots++
      }
    }
    bookedSlots.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    return { timeOff: toTimeOff(timeOff), removedSlots, bookedSlots }
  })
}

/** `DELETE /clinic-portal/time-off/{id}`: regenera as regras ativas do profissional. */
export function deleteClinicTimeOff(clinicAccountId: string, timeOffId: string, now: Date = new Date()) {
  return respond((): ScheduleGeneration => {
    const { clinicId } = requireAccount(clinicAccountId)
    const timeOff = db.timeOffs.find((t) => t.id === timeOffId && t.clinicId === clinicId)
    if (!timeOff) throw new AppError('NOT_FOUND')
    db.timeOffs = db.timeOffs.filter((t) => t.id !== timeOffId)
    return generateRules(
      db,
      db.scheduleRules.filter((r) => r.clinicId === clinicId && r.active && r.professionalId === timeOff.professionalId),
      now,
    )
  })
}
