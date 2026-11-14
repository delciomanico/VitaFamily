import { AppError } from '@/lib/errors'
import type {
  ClinicInsurer,
  ClinicInsurerService,
  InsurerCoverageLimits,
  InsurerEligibilityRequest,
  EligibilityLight,
  InsurerEligibilityResult,
  Page,
} from '@/types/insurerOps'
import { db } from '../db'
import { respond } from '../respond'

/**
 * Validação de beneficiário no portal da clínica (`/clinic-portal/insurers*`, UC-SEG-05, Fase A).
 * Reproduz o contrato: só CLINIC_ADMIN/CLINIC_MANAGER; só seguradoras ligadas (provider ACTIVE) e
 * com módulo ativo, senão NOT_FOUND; resposta mínima e idêntica para qualquer "não elegível" (BR-SEG-18).
 */
export const ELIGIBILITY_NOTICE = 'Verificação de cobertura, não garantia de pagamento.'
/** Limite simulado por clínica (o valor real é do servidor): pedidos por janela. */
export const ELIGIBILITY_LIMIT = 20
export const ELIGIBILITY_WINDOW_MS = 60_000
export const RETRY_AFTER_SECONDS = 30

export function clinicOf(accountId: string): string {
  const account = db.clinicAccounts.find((a) => a.id === accountId && a.status === 'ACTIVE')
  if (!account) throw new AppError('INVALID_CREDENTIALS')
  if (account.role === 'CLINIC_DOCTOR') throw new AppError('FORBIDDEN') // BR-CLN-39 / Q6
  return account.clinicId
}

function linkedInsurerIds(clinicId: string): string[] {
  return db.insurerOps.providers
    .filter((p) => p.clinicId === clinicId && p.status === 'ACTIVE')
    .map((p) => p.insurerId)
    .filter((insurerId) => db.insurerOps.modules[insurerId]?.enabled)
}

export function requireLinked(accountId: string, insurerId: string) {
  const clinicId = clinicOf(accountId)
  if (!linkedInsurerIds(clinicId).includes(insurerId)) throw new AppError('NOT_FOUND')
  return clinicId
}

export function listClinicInsurers(accountId: string) {
  return respond((): ClinicInsurer[] => {
    const ids = linkedInsurerIds(clinicOf(accountId))
    return db.insurers
      .filter((i) => ids.includes(i.id) && i.status === 'ACTIVE')
      .map((i) => ({ id: i.id, name: i.name, currency: db.insurerOps.modules[i.id]?.currency ?? 'AOA' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-PT'))
  })
}

const daysBetween = (from: string, to: string) =>
  Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000)
const addDays = (iso: string, days: number) => {
  const date = new Date(`${iso}T00:00:00`)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Limites por serviço de uma apólice à data `today` (só os cobertos; `coveredNow=false` na carência, BR-SEG-04/31). */
export function policyCoverages(
  policy: { planId: string; validFrom: string },
  today: string,
  serviceCode?: string,
): InsurerCoverageLimits[] {
  return db.insurerOps.coverages
    .filter((c) => c.planId === policy.planId && c.covered && (!serviceCode || c.serviceCode === serviceCode))
    .map((c) => {
      const waitingEndsOn = c.waitingDays > 0 ? addDays(policy.validFrom, c.waitingDays) : null
      return {
        serviceCode: c.serviceCode,
        serviceName: c.serviceName,
        coveredNow: waitingEndsOn === null || daysBetween(today, waitingEndsOn) <= 0,
        copayPct: c.copayPct,
        limitPerYear: c.limitPerYear ?? null,
        waitingDays: c.waitingDays,
        waitingEndsOn,
        requiresAuthorization: c.requiresAuthorization,
      }
    })
}

/** Semáforo (BR-SEG-43): sem cobertura ⇒ vermelho; exige autorização ou em carência ⇒ amarelo; senão verde. */
export function lightOf(coverage: InsurerCoverageLimits | undefined): { light: EligibilityLight; patientSharePct: number | null } {
  if (!coverage) return { light: 'RED', patientSharePct: null }
  const light: EligibilityLight = coverage.requiresAuthorization || !coverage.coveredNow ? 'YELLOW' : 'GREEN'
  return { light, patientSharePct: Math.round((100 - coverage.copayPct) * 100) / 100 }
}

export function checkEligibility(accountId: string, insurerId: string, request: InsurerEligibilityRequest, now: Date = new Date()) {
  return respond((): InsurerEligibilityResult => {
    const clinicId = requireLinked(accountId, insurerId)
    const identifiers = [request.cardNumber, request.qrToken, request.idDocument].filter((v) => v !== undefined && v !== '')
    if (identifiers.length !== 1) throw new AppError('VALIDATION_ERROR')

    const recent = (db.insurerOps.eligibilityChecks[clinicId] ?? []).filter((t) => now.getTime() - t < ELIGIBILITY_WINDOW_MS)
    if (recent.length >= ELIGIBILITY_LIMIT) {
      db.insurerOps.eligibilityChecks[clinicId] = recent
      throw new AppError('RATE_LIMITED', RETRY_AFTER_SECONDS)
    }
    db.insurerOps.eligibilityChecks[clinicId] = [...recent, now.getTime()]

    const notEligible: InsurerEligibilityResult = { eligible: false, notice: ELIGIBILITY_NOTICE }
    const people = db.insurerOps.beneficiaries.filter((b) => b.insurerId === insurerId)
    const norm = (v: string) => v.trim().toLowerCase()
    let beneficiary
    if (request.cardNumber) beneficiary = people.find((b) => norm(b.cardNumber) === norm(request.cardNumber ?? ''))
    else if (request.qrToken) {
      // Token simulado `qr.<insurerId>.<nº do cartão>`; de outra seguradora ou malformado ⇒ igual a "não encontrado".
      const [prefix, tokenInsurer, card] = request.qrToken.split('.')
      if (prefix === 'qr' && tokenInsurer === insurerId) beneficiary = people.find((b) => b.cardNumber === card)
    } else if (request.idDocument) {
      const { type, number } = request.idDocument
      beneficiary = people.find((b) => norm(b.idDocumentType) === norm(type) && norm(b.idDocumentNumber) === norm(number))
    }
    if (!beneficiary || beneficiary.status !== 'ACTIVE') return notEligible

    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const policy = db.insurerOps.policies.find(
      (p) =>
        p.insurerId === insurerId &&
        p.holderId === (beneficiary.holderId ?? beneficiary.id) &&
        p.status === 'ACTIVE' &&
        p.validFrom <= today &&
        today <= p.validTo,
    )
    if (!policy) return notEligible

    const coverages = policyCoverages(policy, today, request.serviceCode)
    return {
      eligible: true,
      notice: ELIGIBILITY_NOTICE,
      beneficiaryName: beneficiary.name,
      status: 'ACTIVE',
      planName: policy.planName,
      validFrom: policy.validFrom,
      validTo: policy.validTo,
      currency: db.insurerOps.modules[insurerId]?.currency ?? 'AOA',
      coverages,
      // Só com um serviço ATIVO da lista da seguradora (a resposta sem `serviceCode` é a de antes).
      ...(request.serviceCode && db.insurerOps.services.some((s) => s.insurerId === insurerId && s.code === request.serviceCode && s.status === 'ACTIVE')
        ? lightOf(coverages[0])
        : {}),
    }
  })
}

export function listClinicInsurerServices(
  accountId: string,
  insurerId: string,
  query: { limit?: number; cursor?: string; q?: string } = {},
) {
  return respond((): Page<ClinicInsurerService> => {
    requireLinked(accountId, insurerId)
    const q = query.q?.trim().toLowerCase() ?? ''
    const all = db.insurerOps.services
      .filter((s) => s.insurerId === insurerId && s.status === 'ACTIVE')
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
      .sort((a, b) => a.code.localeCompare(b.code, 'pt-PT'))
      .map(({ code, name, category }) => ({ code, name, category, guideType: category === 'Consultas' ? 'CONSULTATION' : category ? 'SERVICES' : null }))
    const limit = query.limit ?? 25
    const start = query.cursor ? Number(query.cursor) : 0
    return { items: all.slice(start, start + limit), nextCursor: start + limit < all.length ? String(start + limit) : null }
  })
}
