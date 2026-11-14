import { AppError } from '@/lib/errors'
import type {
  InsuranceCard,
  InsuranceCardClaim,
  InsuranceCardClaimRequest,
  InsuranceCardCoverage,
  InsuranceCardQr,
} from '@/types/insuranceCard'
import { CARD_QR_TTL_SECONDS } from '@/types/insuranceCard'
import { memberAccess } from '../access'
import { db, newId } from '../db'
import { respond } from '../respond'
import { policyCoverages } from './clinicInsurers'

/**
 * Reclamar e usar o cartão da seguradora no app (`/families/{f}/members/{m}/insurance/{card-claims,cards}`,
 * ADR-025 Fase A, UC-SEG-14/15). Reproduz o contrato: SELF/TUTOR_OF; qualquer outro ⇒ NOT_FOUND (nunca
 * FORBIDDEN); perfil bloqueado ⇒ MEMBER_BLOCKED; módulo da seguradora inativo ⇒ NOT_FOUND; reclamar com
 * resposta única e genérica (anti-enumeração); só cobertura e limites, sem saldo (D-A2).
 */
export const CLAIM_LIMIT = 10
export const CLAIM_WINDOW_MS = 15 * 60_000
export const QR_LIMIT = 20
export const QR_WINDOW_MS = 10 * 60_000

type Link = (typeof db.insurerOps.linkRequests)[number]

function requireHolder(familyId: string, userId: string, memberId: string) {
  const member = db.members.find((m) => m.id === memberId && m.familyId === familyId)
  if (member?.status === 'BLOCKED') throw new AppError('MEMBER_BLOCKED')
  if (!memberAccess(familyId, userId, memberId).manage) throw new AppError('NOT_FOUND')
}

/** Como o backend (`hashClaimCode`): sem hífenes nem espaços e sem distinguir maiúsculas. */
const normalizeCode = (code: string) => code.replace(/[-\s]/g, '').toUpperCase()
const moduleOn = (insurerId: string) =>
  Boolean(db.insurerOps.modules[insurerId]?.enabled) && db.insurers.some((i) => i.id === insurerId && i.status === 'ACTIVE')
const insurerName = (insurerId: string) => db.insurers.find((i) => i.id === insurerId)?.name ?? ''
const isoDay = (now: Date) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

const view = (link: Link): InsuranceCardClaim => ({
  id: link.id,
  insurerId: link.insurerId,
  insurerName: insurerName(link.insurerId),
  beneficiaryId: link.status === 'CONFIRMED' ? link.beneficiaryId : null,
  status: link.status,
  requestedAt: link.requestedAt,
  decidedAt: link.decidedAt ?? null,
  decisionNote: link.decisionNote ?? null,
})

const linksOf = (familyId: string, memberId: string) =>
  db.insurerOps.linkRequests.filter((l) => l.familyId === familyId && l.memberId === memberId && moduleOn(l.insurerId))

function confirmedLink(familyId: string, memberId: string, beneficiaryId: string) {
  const link = linksOf(familyId, memberId).find((l) => l.beneficiaryId === beneficiaryId && l.status === 'CONFIRMED')
  const beneficiary = db.insurerOps.beneficiaries.find((b) => b.id === beneficiaryId && b.insurerId === link?.insurerId)
  if (!link || !beneficiary) throw new AppError('NOT_FOUND')
  return { link, beneficiary }
}

/** Apólice `ACTIVE` vigente do titular do beneficiário (BR-SEG-30/36); sem ela, plano e validade são `null`. */
function activePolicy(insurerId: string, holderBeneficiaryId: string, today: string) {
  return (
    db.insurerOps.policies.find(
      (p) => p.insurerId === insurerId && p.holderId === holderBeneficiaryId && p.status === 'ACTIVE' && p.validFrom <= today && today <= p.validTo,
    ) ?? null
  )
}

export function listCardClaims(familyId: string, userId: string, memberId: string) {
  return respond(() => {
    requireHolder(familyId, userId, memberId)
    return linksOf(familyId, memberId)
      .map(view)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
  })
}

export function claimCard(familyId: string, userId: string, memberId: string, input: InsuranceCardClaimRequest, now: Date = new Date()) {
  return respond(() => {
    requireHolder(familyId, userId, memberId)
    const recent = (db.insurerOps.claimAttempts[userId] ?? []).filter((t) => now.getTime() - t < CLAIM_WINDOW_MS)
    if (recent.length >= CLAIM_LIMIT) {
      db.insurerOps.claimAttempts[userId] = recent
      throw new AppError('RATE_LIMITED', Math.max(1, Math.ceil((recent[0]! + CLAIM_WINDOW_MS - now.getTime()) / 1000)))
    }
    db.insurerOps.claimAttempts[userId] = [...recent, now.getTime()]

    if (!input.insurerId || !input.policyNumber.trim() || !normalizeCode(input.code)) throw new AppError('VALIDATION_ERROR')
    if (!moduleOn(input.insurerId)) throw new AppError('NOT_FOUND')
    // Apólice inexistente, código errado/expirado/usado ou beneficiário já ligado a outro: o mesmo NOT_FOUND.
    const policy = db.insurerOps.policies.find(
      (p) => p.insurerId === input.insurerId && p.number.toLowerCase() === input.policyNumber.trim().toLowerCase(),
    )
    const code = db.insurerOps.claimCodes.find(
      (c) =>
        c.insurerId === input.insurerId &&
        !c.used &&
        c.code === normalizeCode(input.code) &&
        new Date(c.expiresAt).getTime() > now.getTime(),
    )
    const beneficiary = code && db.insurerOps.beneficiaries.find((b) => b.id === code.beneficiaryId)
    const ofPolicy = policy && beneficiary && (beneficiary.holderId ?? beneficiary.id) === policy.holderId
    const takenByOther = beneficiary
      ? db.insurerOps.linkRequests.some(
          (l) => l.beneficiaryId === beneficiary.id && (l.status === 'PENDING' || l.status === 'CONFIRMED') && l.memberId !== memberId,
        )
      : false
    if (!code || !beneficiary || !ofPolicy || takenByOther) throw new AppError('NOT_FOUND')

    // 1 beneficiário por membro e seguradora (BR-SEG-35).
    const exists = db.insurerOps.linkRequests.some(
      (l) => l.insurerId === input.insurerId && l.familyId === familyId && l.memberId === memberId && (l.status === 'PENDING' || l.status === 'CONFIRMED'),
    )
    if (exists) throw new AppError('CONFLICT')

    code.used = true // uso único, consumido ao criar o pedido (BR-SEG-32)
    const link: Link = {
      id: newId('lnk'),
      insurerId: input.insurerId,
      familyId,
      memberId,
      beneficiaryId: beneficiary.id,
      beneficiaryName: beneficiary.name,
      cardNumber: beneficiary.cardNumber,
      status: 'PENDING',
      requestedAt: now.toISOString(),
      decidedAt: null,
      decisionNote: null,
    }
    db.insurerOps.linkRequests.push(link)
    return view(link)
  })
}

export function revokeCardClaim(familyId: string, userId: string, memberId: string, claimId: string) {
  return respond(() => {
    requireHolder(familyId, userId, memberId)
    const link = linksOf(familyId, memberId).find((l) => l.id === claimId)
    if (!link) throw new AppError('NOT_FOUND')
    if (link.status !== 'CONFIRMED') throw new AppError('CONFLICT')
    link.status = 'REVOKED'
    link.decidedAt = new Date().toISOString()
    const beneficiary = db.insurerOps.beneficiaries.find((b) => b.id === link.beneficiaryId)
    if (beneficiary) beneficiary.linked = false
    return undefined
  })
}

export function listCards(familyId: string, userId: string, memberId: string, now: Date = new Date()) {
  return respond((): InsuranceCard[] => {
    requireHolder(familyId, userId, memberId)
    return linksOf(familyId, memberId)
      .filter((l) => l.status === 'CONFIRMED')
      .flatMap((l) => {
        const b = db.insurerOps.beneficiaries.find((x) => x.id === l.beneficiaryId && x.insurerId === l.insurerId)
        if (!b) return []
        const policy = activePolicy(l.insurerId, b.holderId ?? b.id, isoDay(now))
        return [
          {
            beneficiaryId: b.id,
            insurerId: l.insurerId,
            insurerName: insurerName(l.insurerId),
            currency: db.insurerOps.modules[l.insurerId]?.currency ?? 'AOA',
            beneficiaryName: b.name,
            cardNumber: b.cardNumber,
            status: b.status,
            planName: policy?.planName ?? null,
            policyNumber: policy?.number ?? null,
            validFrom: policy?.validFrom ?? null,
            validTo: policy?.validTo ?? null,
          },
        ]
      })
  })
}

export function getCardQr(familyId: string, userId: string, memberId: string, beneficiaryId: string, now: Date = new Date()) {
  return respond((): InsuranceCardQr => {
    requireHolder(familyId, userId, memberId)
    const { link } = confirmedLink(familyId, memberId, beneficiaryId)
    const recent = (db.insurerOps.qrIssues[beneficiaryId] ?? []).filter((t) => now.getTime() - t < QR_WINDOW_MS)
    if (recent.length >= QR_LIMIT) {
      db.insurerOps.qrIssues[beneficiaryId] = recent
      throw new AppError('RATE_LIMITED', Math.max(1, Math.ceil((recent[0]! + QR_WINDOW_MS - now.getTime()) / 1000)))
    }
    db.insurerOps.qrIssues[beneficiaryId] = [...recent, now.getTime()]
    const beneficiary = db.insurerOps.beneficiaries.find((b) => b.id === beneficiaryId)!
    // Token simulado, o mesmo formato que a validação na clínica aceita (`qr.<insurerId>.<nº do cartão>`).
    return {
      token: `qr.${link.insurerId}.${beneficiary.cardNumber}`,
      expiresAt: new Date(now.getTime() + CARD_QR_TTL_SECONDS * 1000).toISOString(),
      cardVersion: 1,
    }
  })
}

export function getCardCoverage(familyId: string, userId: string, memberId: string, beneficiaryId: string, now: Date = new Date()) {
  return respond((): InsuranceCardCoverage => {
    requireHolder(familyId, userId, memberId)
    const { link, beneficiary } = confirmedLink(familyId, memberId, beneficiaryId)
    const today = isoDay(now)
    const policy = activePolicy(link.insurerId, beneficiary.holderId ?? beneficiary.id, today)
    return {
      beneficiaryId,
      insurerId: link.insurerId,
      currency: db.insurerOps.modules[link.insurerId]?.currency ?? 'AOA',
      status: beneficiary.status,
      planName: policy?.planName ?? null,
      policyNumber: policy?.number ?? null,
      validFrom: policy?.validFrom ?? null,
      validTo: policy?.validTo ?? null,
      // Beneficiário não ACTIVE ou sem apólice vigente: sem coberturas (contrato).
      coverages: beneficiary.status === 'ACTIVE' && policy ? policyCoverages(policy, today) : [],
    }
  })
}
