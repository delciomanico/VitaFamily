import { AppError } from '@/lib/errors'
import { CREDENTIAL_MAX_BYTES, CREDENTIAL_TYPES, editRights } from '@/lib/professional'
import { PASSWORD_MIN_LENGTH } from '@/lib/policy'
import { professionalSessionStore } from '@/lib/storage'
import {
  MAX_PRICE_KZ,
  OFFER_DURATIONS,
  type CredentialUploadInput,
  type ProfessionalCredential,
  type ProfessionalOffer,
  type ProfessionalOfferInput,
  type ProfessionalOfferPatch,
  type ProfessionalProfile,
  type ProfessionalProfilePatch,
  type ProfessionalRegisterInput,
  type ProfessionalRequirement,
  type ProfessionalScheduleGeneration,
  type ProfessionalScheduleRule,
  type ProfessionalScheduleRuleInput,
  type ProfessionalScheduleRulePatch,
  type ProfessionalScheduleRuleResult,
  type ProfessionalSession,
  type ProfessionalSlot,
  type ProfessionalTimeOff,
  type ProfessionalTimeOffInput,
  type Specialty,
} from '@/types/professional'
import { DEMO_PROFESSIONAL_CODE, newProfessional, professionalDb, proId, type MockProfessional, type MockProfessionalCredential } from '../professionalDb'
import { respond, respondBlob } from '../respond'

/*
 * Portal do profissional (`/professional-portal/*`, MK1, ADR-037). Espaço de identidade próprio: nenhum
 * handler recebe `userId`/`familyId`; o profissional resolve-se sempre pela sessão (authorization.md §10.1).
 * O estado de validação é lido do registo **por pedido** e aplica a matriz §10.2 (`PROFESSIONAL_LOCKED`).
 */

const normalize = (email: string) => email.trim().toLowerCase()
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MAX_CREDENTIALS = 10
const MAX_ACTIVE = 20
/** Africa/Luanda = UTC+1 sem DST. */
const LUANDA_OFFSET = '+01:00'
const GENERATION_DAYS = 56 // janela rolante de 8 semanas (BR-MKT-25)

function session(account: MockProfessional): ProfessionalSession {
  return { professionalId: account.id, email: account.email, validationStatus: account.validationStatus }
}

/** Conta da sessão; sem sessão válida → UNAUTHENTICATED (INVALID_CREDENTIALS na UI). */
export function requireProfessional(): MockProfessional {
  const id = professionalSessionStore.getAccountId()
  const record = id ? professionalDb.professionals.find((p) => p.id === id && p.verified) : undefined
  if (!record) throw new AppError('INVALID_CREDENTIALS')
  return record
}

// ───── Autenticação (UC-MKT-01/02) ─────

/** Resposta neutra: e-mail novo cria conta por verificar; e-mail existente não faz nada visível (BR-MKT-14). */
export function professionalRegister(input: ProfessionalRegisterInput): Promise<void> {
  return respond(() => {
    const email = normalize(input.email)
    if (!EMAIL_PATTERN.test(email) || !input.termsVersion) throw new AppError('VALIDATION_ERROR')
    if (input.password.length < PASSWORD_MIN_LENGTH) throw new AppError('PASSWORD_WEAK')
    if (!professionalDb.professionals.some((p) => p.email === email)) newProfessional(email, input.password)
  })
}

export function professionalVerifyEmail(email: string, code: string): Promise<void> {
  return respond(() => {
    const record = professionalDb.professionals.find((p) => p.email === normalize(email))
    if (!record || record.verified || code.trim() !== DEMO_PROFESSIONAL_CODE) throw new AppError('INVALID_CODE')
    record.verified = true
  })
}

export function professionalResendVerification(_email: string): Promise<void> {
  return respond(() => undefined)
}

export function professionalLogin(email: string, password: string): Promise<ProfessionalSession> {
  return respond(() => {
    const record = professionalDb.professionals.find((p) => p.email === normalize(email))
    if (!record || record.password !== password) throw new AppError('INVALID_CREDENTIALS')
    if (!record.verified) throw new AppError('EMAIL_NOT_VERIFIED')
    professionalSessionStore.setAccountId(record.id)
    return session(record)
  })
}

/** Retoma a sessão da aba (na API real: `POST /professional-portal/auth/refresh`). */
export function professionalRestore(): Promise<ProfessionalSession | null> {
  return respond(() => {
    const id = professionalSessionStore.getAccountId()
    const record = id ? professionalDb.professionals.find((p) => p.id === id && p.verified) : undefined
    return record ? session(record) : null
  })
}

export function professionalLogout(): Promise<void> {
  return respond(() => professionalSessionStore.setAccountId(null))
}

export function professionalForgotPassword(email: string): Promise<void> {
  return respond(() => {
    const record = professionalDb.professionals.find((p) => p.email === normalize(email))
    if (record?.verified) record.resetPending = true
  })
}

export function professionalResetPassword(email: string, code: string, newPassword: string): Promise<void> {
  return respond(() => {
    if (newPassword.length < PASSWORD_MIN_LENGTH) throw new AppError('PASSWORD_WEAK')
    const record = professionalDb.professionals.find((p) => p.email === normalize(email))
    if (!record || !record.resetPending || code.trim() !== DEMO_PROFESSIONAL_CODE) throw new AppError('INVALID_CODE')
    record.password = newPassword
    record.resetPending = false
    // Todas as sessões são revogadas (UC-MKT-02).
    if (professionalSessionStore.getAccountId() === record.id) professionalSessionStore.setAccountId(null)
  })
}

// ───── Requisitos (BR-MKT-16) ─────

const todayISO = () => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10)
const isExpired = (c: ProfessionalCredential) => c.validUntil !== undefined && c.validUntil < todayISO()

/** Função pura do domínio, espelhada: o que falta para submeter. */
export function requirementsOf(record: MockProfessional): ProfessionalProfile['requirements'] {
  const missing: ProfessionalRequirement[] = []
  if (!record.displayName?.trim()) missing.push('DISPLAY_NAME')
  if (!record.city?.trim()) missing.push('CITY')
  const specs = professionalDb.specialties.filter((s) => record.specialtyIds.includes(s.id))
  if (specs.length === 0) missing.push('SPECIALTY')
  const needed = new Set<MockProfessionalCredential['kind']>()
  for (const s of specs) {
    needed.add('IDENTITY')
    needed.add(s.category === 'HEALTH' ? 'PROFESSIONAL_LICENSE' : 'CERTIFICATION')
  }
  const kindReq = { IDENTITY: 'CREDENTIAL_IDENTITY', PROFESSIONAL_LICENSE: 'CREDENTIAL_PROFESSIONAL_LICENSE', CERTIFICATION: 'CREDENTIAL_CERTIFICATION' } as const
  for (const kind of needed) {
    const ok = record.credentials.some((c) => c.kind === kind && c.scanStatus === 'CLEAN' && !isExpired(c))
    if (!ok) missing.push(kindReq[kind])
  }
  if (record.credentials.some((c) => c.scanStatus === 'PENDING')) missing.push('CREDENTIAL_SCAN_PENDING')
  if (record.credentials.some((c) => c.scanStatus === 'INFECTED')) missing.push('CREDENTIAL_INFECTED')
  if (record.credentials.some((c) => c.scanStatus === 'CLEAN' && isExpired(c))) missing.push('CREDENTIAL_EXPIRED')
  const canSubmit = editRights(record.validationStatus).submit && missing.length === 0
  return { canSubmit, missing }
}

function profileOf(record: MockProfessional): ProfessionalProfile {
  const specialties: Specialty[] = professionalDb.specialties
    .filter((s) => record.specialtyIds.includes(s.id))
    .map(({ id, name, category }) => ({ id, name, category }))
  return {
    id: record.id,
    email: record.email,
    displayName: record.displayName,
    bio: record.bio,
    city: record.city,
    paymentInstructions: record.paymentInstructions,
    validationStatus: record.validationStatus,
    statusReason: record.statusReason,
    statusChangedAt: record.statusChangedAt,
    submittedAt: record.submittedAt,
    approvedAt: record.approvedAt,
    specialties,
    requirements: requirementsOf(record),
  }
}

const locked = (allowed: boolean) => {
  if (!allowed) throw new AppError('PROFESSIONAL_LOCKED')
}

// ───── Perfil e especialidades (UC-MKT-03) ─────

export function getProfessionalMe(): Promise<ProfessionalProfile> {
  return respond(() => profileOf(requireProfessional()))
}

export function updateProfessionalMe(patch: ProfessionalProfilePatch): Promise<ProfessionalProfile> {
  return respond(() => {
    const record = requireProfessional()
    const rights = editRights(record.validationStatus)
    if (Object.keys(patch).length === 0) throw new AppError('VALIDATION_ERROR')
    if (patch.displayName !== undefined) {
      locked(rights.identity)
      const name = patch.displayName.trim()
      if (name.length < 2 || name.length > 120) throw new AppError('VALIDATION_ERROR')
      record.displayName = name
    }
    if (patch.city !== undefined || patch.bio !== undefined || patch.paymentInstructions !== undefined) locked(rights.profileText)
    if (patch.city !== undefined) {
      const city = patch.city.trim()
      if (city.length < 2 || city.length > 80) throw new AppError('VALIDATION_ERROR')
      record.city = city
    }
    if (patch.bio !== undefined) {
      if ((patch.bio?.length ?? 0) > 1000) throw new AppError('VALIDATION_ERROR')
      record.bio = patch.bio?.trim() || undefined
    }
    if (patch.paymentInstructions !== undefined) {
      if ((patch.paymentInstructions?.length ?? 0) > 500) throw new AppError('VALIDATION_ERROR')
      record.paymentInstructions = patch.paymentInstructions?.trim() || undefined
    }
    return profileOf(record)
  })
}

export function listProfessionalSpecialtyCatalog(): Promise<Specialty[]> {
  return respond(() => {
    requireProfessional()
    return professionalDb.specialties
      .filter((s) => s.active)
      .map(({ id, name, category }) => ({ id, name, category }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-PT'))
  })
}

export function setProfessionalSpecialties(specialtyIds: string[]): Promise<ProfessionalProfile> {
  return respond(() => {
    const record = requireProfessional()
    locked(editRights(record.validationStatus).identity)
    const unique = [...new Set(specialtyIds)]
    if (unique.length < 1 || unique.length > 5) throw new AppError('VALIDATION_ERROR')
    // Só ativas, mas as que o profissional já tinha mantêm-se aceites.
    const ok = unique.every((id) => professionalDb.specialties.some((s) => s.id === id && (s.active || record.specialtyIds.includes(id))))
    if (!ok) throw new AppError('VALIDATION_ERROR')
    const removed = record.specialtyIds.filter((id) => !unique.includes(id))
    if (removed.some((id) => record.offers.some((o) => o.specialtyId === id))) throw new AppError('CONFLICT')
    record.specialtyIds = unique
    return profileOf(record)
  })
}

// ───── Credenciais (UC-MKT-04) ─────

const toCredential = ({ ticks: _t, fileName: _f, ...credential }: MockProfessionalCredential): ProfessionalCredential => credential

/** Simula o job de antivírus: uma credencial `PENDING` fica `CLEAN` (ou `INFECTED`) na leitura seguinte. */
function tickScan(record: MockProfessional) {
  for (const c of record.credentials) {
    if (c.scanStatus !== 'PENDING') continue
    if (c.ticks >= 1) c.scanStatus = /eicar|virus/i.test(c.fileName) ? 'INFECTED' : 'CLEAN'
    else c.ticks += 1
  }
}

export function listProfessionalCredentials(): Promise<ProfessionalCredential[]> {
  return respond(() => {
    const record = requireProfessional()
    tickScan(record)
    return record.credentials.map(toCredential)
  })
}

export function uploadProfessionalCredential(input: CredentialUploadInput): Promise<ProfessionalCredential> {
  return respond(() => {
    const record = requireProfessional()
    locked(editRights(record.validationStatus).identity)
    if (!CREDENTIAL_TYPES.includes(input.file.type)) throw new AppError('FILE_TYPE_NOT_ALLOWED')
    if (input.file.size > CREDENTIAL_MAX_BYTES) throw new AppError('FILE_TOO_LARGE')
    if (input.file.size < 1) throw new AppError('VALIDATION_ERROR')
    if (record.credentials.length >= MAX_CREDENTIALS) throw new AppError('LIMIT_EXCEEDED')
    if (input.validUntil && !DATE_PATTERN.test(input.validUntil)) throw new AppError('VALIDATION_ERROR')
    const credential: MockProfessionalCredential = {
      id: proId('crd'),
      kind: input.kind,
      number: input.number?.trim().slice(0, 60) || undefined,
      issuingBody: input.issuingBody?.trim().slice(0, 120) || undefined,
      validUntil: input.validUntil || undefined,
      scanStatus: 'PENDING',
      contentType: input.file.type as ProfessionalCredential['contentType'],
      sizeBytes: input.file.size,
      createdAt: new Date().toISOString(),
      ticks: 0,
      fileName: input.file.name,
    }
    record.credentials.push(credential)
    professionalDb.files.set(credential.id, input.file)
    return toCredential(credential)
  })
}

function credentialOf(record: MockProfessional, id: string): MockProfessionalCredential {
  const credential = record.credentials.find((c) => c.id === id)
  if (!credential) throw new AppError('NOT_FOUND')
  return credential
}

export function deleteProfessionalCredential(credentialId: string): Promise<void> {
  return respond(() => {
    const record = requireProfessional()
    const credential = credentialOf(record, credentialId)
    locked(editRights(record.validationStatus).identity)
    record.credentials = record.credentials.filter((c) => c.id !== credential.id)
    professionalDb.files.delete(credential.id)
  })
}

/** Só `CLEAN` se descarrega (`INFECTED`/`PENDING` ⇒ 409). */
export function downloadProfessionalCredential(credentialId: string): Promise<Blob> {
  return respondBlob(() => {
    const record = requireProfessional()
    const credential = credentialOf(record, credentialId)
    if (credential.scanStatus !== 'CLEAN') throw new AppError('DOCUMENT_NOT_AVAILABLE')
    return professionalDb.files.get(credential.id) ?? new Blob([], { type: credential.contentType })
  })
}

// ───── Submissão (UC-MKT-05) ─────

export function submitProfessionalForReview(): Promise<ProfessionalProfile> {
  return respond(() => {
    const record = requireProfessional()
    if (!editRights(record.validationStatus).submit) throw new AppError('INVALID_STATE_TRANSITION')
    if (requirementsOf(record).missing.length > 0) throw new AppError('VALIDATION_ERROR')
    const now = new Date().toISOString()
    record.history.push({ id: proId('val'), action: 'SUBMITTED', fromStatus: record.validationStatus, toStatus: 'PENDING_REVIEW', actor: 'PROFESSIONAL', createdAt: now })
    record.validationStatus = 'PENDING_REVIEW'
    record.statusReason = undefined
    record.statusChangedAt = now
    record.submittedAt = now
    return profileOf(record)
  })
}

// ───── Ofertas e preços (UC-MKT-08) ─────

export function listProfessionalOffers(active?: boolean): Promise<ProfessionalOffer[]> {
  return respond(() => requireProfessional().offers.filter((o) => active === undefined || o.active === active))
}

const activeOffers = (record: MockProfessional) => record.offers.filter((o) => o.active)

function checkPrice(priceKz: number) {
  if (!Number.isInteger(priceKz) || priceKz < 0 || priceKz > MAX_PRICE_KZ) throw new AppError('VALIDATION_ERROR')
}

function checkNote(note: string | null | undefined) {
  if ((note?.length ?? 0) > 200) throw new AppError('VALIDATION_ERROR')
}

function isDuplicate(record: MockProfessional, offer: Pick<ProfessionalOffer, 'specialtyId' | 'method' | 'durationMinutes'>, ignoreId?: string) {
  return activeOffers(record).some(
    (o) => o.id !== ignoreId && o.specialtyId === offer.specialtyId && o.method === offer.method && o.durationMinutes === offer.durationMinutes,
  )
}

export function createProfessionalOffer(input: ProfessionalOfferInput): Promise<ProfessionalOffer> {
  return respond(() => {
    const record = requireProfessional()
    locked(editRights(record.validationStatus).commercial)
    if (!record.specialtyIds.includes(input.specialtyId)) throw new AppError('VALIDATION_ERROR')
    if (!OFFER_DURATIONS.includes(input.durationMinutes) || !['IN_PERSON', 'VIDEO', 'CHAT', 'PHONE'].includes(input.method)) throw new AppError('VALIDATION_ERROR')
    checkPrice(input.priceKz)
    checkNote(input.note)
    if (isDuplicate(record, input)) throw new AppError('CONFLICT')
    if (activeOffers(record).length >= MAX_ACTIVE) throw new AppError('LIMIT_EXCEEDED')
    const offer: ProfessionalOffer = {
      id: proId('ofr'),
      specialtyId: input.specialtyId,
      method: input.method,
      durationMinutes: input.durationMinutes,
      priceKz: input.priceKz,
      note: input.note?.trim() || undefined,
      active: true,
    }
    record.offers.push(offer)
    return offer
  })
}

export function updateProfessionalOffer(offerId: string, patch: ProfessionalOfferPatch): Promise<ProfessionalOffer> {
  return respond(() => {
    const record = requireProfessional()
    const offer = record.offers.find((o) => o.id === offerId)
    if (!offer) throw new AppError('NOT_FOUND')
    locked(editRights(record.validationStatus).commercial)
    if (Object.keys(patch).length === 0) throw new AppError('VALIDATION_ERROR')
    if (patch.priceKz !== undefined) checkPrice(patch.priceKz)
    if (patch.note !== undefined) checkNote(patch.note)
    if (patch.active === true && !offer.active) {
      if (isDuplicate(record, offer, offer.id)) throw new AppError('CONFLICT')
      if (activeOffers(record).length >= MAX_ACTIVE) throw new AppError('LIMIT_EXCEEDED')
    }
    if (patch.priceKz !== undefined) offer.priceKz = patch.priceKz
    if (patch.note !== undefined) offer.note = patch.note?.trim() || undefined
    if (patch.active !== undefined) {
      offer.active = patch.active
      // Desativar remove os horários futuros livres gerados pelas regras da oferta (UC-MKT-08).
      if (!patch.active) record.slots = record.slots.filter((s) => s.offerId !== offer.id)
    }
    return { ...offer }
  })
}

// ───── Regras de horário (UC-MKT-09) ─────

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))

export function listProfessionalScheduleRules(filter: { offerId?: string; active?: boolean } = {}): Promise<ProfessionalScheduleRule[]> {
  return respond(() =>
    requireProfessional().rules.filter(
      (r) => (filter.offerId === undefined || r.offerId === filter.offerId) && (filter.active === undefined || r.active === filter.active),
    ),
  )
}

function checkRuleShape(rule: Pick<ProfessionalScheduleRule, 'weekdays' | 'startTime' | 'endTime' | 'validFrom' | 'validUntil'>, durationMinutes: number) {
  if (rule.weekdays.length < 1 || rule.weekdays.length > 7 || new Set(rule.weekdays).size !== rule.weekdays.length) throw new AppError('VALIDATION_ERROR')
  if (!rule.weekdays.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) throw new AppError('VALIDATION_ERROR')
  if (!TIME_PATTERN.test(rule.startTime) || !TIME_PATTERN.test(rule.endTime)) throw new AppError('VALIDATION_ERROR')
  if (minutes(rule.endTime) - minutes(rule.startTime) < durationMinutes) throw new AppError('VALIDATION_ERROR')
  for (const date of [rule.validFrom, rule.validUntil]) if (date && !DATE_PATTERN.test(date)) throw new AppError('VALIDATION_ERROR')
  if (rule.validFrom && rule.validUntil && rule.validUntil < rule.validFrom) throw new AppError('VALIDATION_ERROR')
}

function overlapsOtherRule(record: MockProfessional, rule: ProfessionalScheduleRule): boolean {
  return record.rules.some(
    (o) =>
      o.id !== rule.id &&
      o.active &&
      o.weekdays.some((d) => rule.weekdays.includes(d)) &&
      minutes(o.startTime) < minutes(rule.endTime) &&
      minutes(rule.startTime) < minutes(o.endTime),
  )
}

const ZERO: ProfessionalScheduleGeneration = { created: 0, unchanged: 0, removed: 0, skippedOverlap: 0, skippedTimeOff: 0 }

/** Geração idempotente (só `APPROVED`, BR-MKT-23): reconcilia os horários futuros da regra. */
function generate(record: MockProfessional, rule: ProfessionalScheduleRule): ProfessionalScheduleGeneration {
  if (record.validationStatus !== 'APPROVED') return { ...ZERO }
  const offer = record.offers.find((o) => o.id === rule.offerId)
  const result = { ...ZERO }
  const before = record.slots.filter((s) => s.ruleId === rule.id)
  record.slots = record.slots.filter((s) => s.ruleId !== rule.id)
  if (!offer || !rule.active || !offer.active) {
    result.removed = before.length
    return result
  }
  const wanted: Array<ProfessionalSlot & { ruleId: string }> = []
  const today = new Date(Date.now() + 3_600_000)
  for (let i = 0; i < GENERATION_DAYS; i++) {
    const day = new Date(today.getTime() + i * 86_400_000)
    const date = day.toISOString().slice(0, 10)
    const isoWeekday = ((day.getUTCDay() + 6) % 7) + 1
    if (!rule.weekdays.includes(isoWeekday as ProfessionalScheduleRule['weekdays'][number])) continue
    if ((rule.validFrom && date < rule.validFrom) || (rule.validUntil && date > rule.validUntil)) continue
    for (let m = minutes(rule.startTime); m + offer.durationMinutes <= minutes(rule.endTime); m += offer.durationMinutes) {
      const hh = String(Math.floor(m / 60)).padStart(2, '0')
      const mm = String(m % 60).padStart(2, '0')
      const startsAt = new Date(`${date}T${hh}:${mm}:00${LUANDA_OFFSET}`)
      if (startsAt.getTime() <= Date.now()) continue
      const endsAt = new Date(startsAt.getTime() + offer.durationMinutes * 60_000)
      if (record.timeOffs.some((t) => Date.parse(t.startsAt) < endsAt.getTime() && startsAt.getTime() < Date.parse(t.endsAt))) {
        result.skippedTimeOff += 1
        continue
      }
      if (record.slots.some((s) => Date.parse(s.startsAt) < endsAt.getTime() && startsAt.getTime() < Date.parse(s.endsAt))) {
        result.skippedOverlap += 1
        continue
      }
      const existing = before.find((s) => s.startsAt === startsAt.toISOString())
      if (existing) result.unchanged += 1
      else result.created += 1
      wanted.push(existing ?? { id: proId('slt'), offerId: offer.id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), ruleId: rule.id })
    }
  }
  record.slots.push(...wanted)
  result.removed = before.filter((s) => !wanted.some((w) => w.id === s.id)).length
  return result
}

export function createProfessionalScheduleRule(input: ProfessionalScheduleRuleInput): Promise<ProfessionalScheduleRuleResult> {
  return respond(() => {
    const record = requireProfessional()
    locked(editRights(record.validationStatus).commercial)
    const offer = record.offers.find((o) => o.id === input.offerId)
    if (!offer) throw new AppError('NOT_FOUND')
    const rule: ProfessionalScheduleRule = {
      id: proId('rul'),
      offerId: offer.id,
      weekdays: [...input.weekdays].sort(),
      startTime: input.startTime,
      endTime: input.endTime,
      validFrom: input.validFrom || undefined,
      validUntil: input.validUntil || undefined,
      active: true,
    }
    checkRuleShape(rule, offer.durationMinutes)
    if (overlapsOtherRule(record, rule)) throw new AppError('CONFLICT')
    if (record.rules.filter((r) => r.active).length >= MAX_ACTIVE) throw new AppError('LIMIT_EXCEEDED')
    record.rules.push(rule)
    return { rule: { ...rule }, generation: generate(record, rule) }
  })
}

export function updateProfessionalScheduleRule(ruleId: string, patch: ProfessionalScheduleRulePatch): Promise<ProfessionalScheduleRuleResult> {
  return respond(() => {
    const record = requireProfessional()
    const rule = record.rules.find((r) => r.id === ruleId)
    if (!rule) throw new AppError('NOT_FOUND')
    locked(editRights(record.validationStatus).commercial)
    if (Object.keys(patch).length === 0) throw new AppError('VALIDATION_ERROR')
    const next: ProfessionalScheduleRule = {
      ...rule,
      ...(patch.weekdays ? { weekdays: [...patch.weekdays].sort() } : {}),
      ...(patch.startTime ? { startTime: patch.startTime } : {}),
      ...(patch.endTime ? { endTime: patch.endTime } : {}),
      ...(patch.validFrom !== undefined ? { validFrom: patch.validFrom || undefined } : {}),
      ...(patch.validUntil !== undefined ? { validUntil: patch.validUntil || undefined } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
    }
    const offer = record.offers.find((o) => o.id === rule.offerId)
    checkRuleShape(next, offer?.durationMinutes ?? 15)
    if (next.active && overlapsOtherRule(record, next)) throw new AppError('CONFLICT')
    if (next.active && !rule.active && record.rules.filter((r) => r.active).length >= MAX_ACTIVE) throw new AppError('LIMIT_EXCEEDED')
    Object.assign(rule, next)
    return { rule: { ...rule }, generation: generate(record, rule) }
  })
}

// ───── Bloqueios e horários gerados (UC-MKT-09) ─────

export function listProfessionalTimeOff(range: { from?: string; to?: string } = {}): Promise<ProfessionalTimeOff[]> {
  return respond(() =>
    requireProfessional()
      .timeOffs.filter((t) => (!range.from || t.endsAt >= range.from) && (!range.to || t.startsAt <= range.to))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
  )
}

export function createProfessionalTimeOff(input: ProfessionalTimeOffInput): Promise<ProfessionalTimeOff> {
  return respond(() => {
    const record = requireProfessional()
    locked(editRights(record.validationStatus).commercial)
    const start = Date.parse(input.startsAt)
    const end = Date.parse(input.endsAt)
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start || end - start > 366 * 86_400_000 || end < Date.now()) throw new AppError('VALIDATION_ERROR')
    if ((input.reason?.length ?? 0) > 200) throw new AppError('VALIDATION_ERROR')
    if (record.timeOffs.some((t) => Date.parse(t.startsAt) < end && start < Date.parse(t.endsAt))) throw new AppError('CONFLICT')
    const timeOff: ProfessionalTimeOff = {
      id: proId('tof'),
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(end).toISOString(),
      reason: input.reason?.trim() || undefined,
    }
    record.timeOffs.push(timeOff)
    // Os horários livres que caem no bloqueio deixam de existir.
    record.slots = record.slots.filter((s) => !(Date.parse(s.startsAt) < end && start < Date.parse(s.endsAt)))
    return timeOff
  })
}

export function deleteProfessionalTimeOff(timeOffId: string): Promise<void> {
  return respond(() => {
    const record = requireProfessional()
    if (!record.timeOffs.some((t) => t.id === timeOffId)) throw new AppError('NOT_FOUND')
    locked(editRights(record.validationStatus).commercial)
    record.timeOffs = record.timeOffs.filter((t) => t.id !== timeOffId)
    for (const rule of record.rules) generate(record, rule)
  })
}

export function listProfessionalSlots(from: string, to: string): Promise<ProfessionalSlot[]> {
  return respond(() => {
    const record = requireProfessional()
    const a = Date.parse(from)
    const b = Date.parse(to)
    if (Number.isNaN(a) || Number.isNaN(b) || b <= a || b - a > 62 * 86_400_000) throw new AppError('VALIDATION_ERROR')
    return record.slots
      .filter((s) => Date.parse(s.startsAt) >= a && Date.parse(s.startsAt) < b)
      .sort((x, y) => x.startsAt.localeCompare(y.startsAt))
      .map(({ ruleId: _r, ...slot }) => slot)
  })
}

/** Na aprovação, geram-se os horários das regras já guardadas (UC-MKT-09, BR-MKT-23). */
export function generateAllSlots(record: MockProfessional) {
  for (const rule of record.rules) generate(record, rule)
}
