import { AppError } from '@/lib/errors'
import type { AuthorizationAttachmentKind, AuthorizationRequest, AuthorizationRequestInput, InsurerEligibilityRequest, Page } from '@/types/insurerOps'
import { db, newId } from '../db'
import { respond } from '../respond'
import { clinicOf, lightOf, policyCoverages } from './clinicInsurers'
import { evaluateAutoApproval } from './insurerAuthorizations'

/**
 * Pedidos de autorização do prestador (`/clinic-portal/authorizations*`, ADR-034). Reproduz o contrato: só Admin/Gestor; só pedidos
 * da própria clínica (outro ⇒ NOT_FOUND); só AMARELO cria pedido (VERMELHO e VERDE ⇒ VALIDATION_ERROR sem razão); nasce IN_REVIEW;
 * duplicado em curso ⇒ CONFLICT; recurso = novo pedido (15 dias). As decisões da seguradora são da fatia 4: os testes usam `decideAs`.
 */
export const APPEAL_DAYS = 15
export const DECISION_HOURS = 48
export const MAX_ATTACHMENTS = 5
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const ATTACHMENT_KINDS: AuthorizationAttachmentKind[] = ['QUOTE', 'INSURER_FORM', 'ID_COPY', 'OTHER_ADMIN']
const PENDING = ['SUBMITTED', 'IN_REVIEW', 'INFO_REQUESTED']
const GUIDE_BY_CATEGORY: Record<string, string> = { Consultas: 'CONSULTATION' }

type Stored = (typeof db.insurerOps.authorizations)[number]

const dayOf = (date: Date) => date.toISOString().slice(0, 10)
const addHours = (date: Date, hours: number) => new Date(date.getTime() + hours * 3_600_000).toISOString()

function find(clinicId: string, id: string): Stored {
  const found = db.insurerOps.authorizations.find((a) => a.id === id && a.clinicId === clinicId)
  if (!found) throw new AppError('NOT_FOUND')
  return found
}

function requireLink(clinicId: string, insurerId: string) {
  const linked = db.insurerOps.providers.some((p) => p.clinicId === clinicId && p.insurerId === insurerId && p.status === 'ACTIVE') && db.insurerOps.modules[insurerId]?.enabled
  if (!linked) throw new AppError('NOT_FOUND')
}

function view(a: Stored, now: Date, detail: boolean): AuthorizationRequest {
  const { clinicId: _c, beneficiaryId: _b, originalDecisionAt: _o, ...rest } = a
  const appealUntil = a.status === 'REJECTED' && a.updatedAt ? new Date(new Date(a.originalDecisionAt ?? a.updatedAt).getTime() + APPEAL_DAYS * 86_400_000) : null
  const hasAppeal = db.insurerOps.authorizations.some((c) => c.parentRequestId === a.id && c.status !== 'CANCELLED')
  const pending = PENDING.includes(a.status)
  const actions: AuthorizationRequest['allowedActions'] = []
  if (a.status === 'INFO_REQUESTED') actions.push('RESPOND')
  if (pending) actions.push('CANCEL')
  if (appealUntil && now <= appealUntil && !hasAppeal) actions.push('APPEAL')
  if (pending) actions.push('ATTACH')
  return { ...rest, appealOpenUntil: appealUntil ? appealUntil.toISOString() : null, allowedActions: actions, ...(detail ? {} : { timeline: undefined }) }
}

function lightFor(insurerId: string, beneficiary: { id: string; holderId: string | null }, serviceCode: string, onDay: string) {
  const policy = db.insurerOps.policies.find((p) => p.insurerId === insurerId && p.holderId === (beneficiary.holderId ?? beneficiary.id) && p.status === 'ACTIVE' && p.validFrom <= onDay && onDay <= p.validTo)
  const coverage = policy ? policyCoverages(policy, onDay, serviceCode)[0] : undefined
  return lightOf(coverage).light
}

function identify(insurerId: string, request: InsurerEligibilityRequest, today: string) {
  const people = db.insurerOps.beneficiaries.filter((b) => b.insurerId === insurerId)
  const norm = (v: string) => v.trim().toLowerCase()
  let found
  if (request.cardNumber) found = people.find((b) => norm(b.cardNumber) === norm(request.cardNumber ?? ''))
  else if (request.qrToken) {
    const [prefix, tokenInsurer, card] = request.qrToken.split('.')
    if (prefix === 'qr' && tokenInsurer === insurerId) found = people.find((b) => b.cardNumber === card)
  } else if (request.idDocument) {
    const { type, number } = request.idDocument
    found = people.find((b) => norm(b.idDocumentType) === norm(type) && norm(b.idDocumentNumber) === norm(number))
  }
  const eligible = found?.status === 'ACTIVE' && db.insurerOps.policies.some((p) => p.insurerId === insurerId && p.holderId === (found.holderId ?? found.id) && p.status === 'ACTIVE' && p.validFrom <= today && today <= p.validTo)
  // Anti-enumeração: inexistente, inelegível ou QR inválido ⇒ o mesmo NOT_FOUND (BR-SEG-18).
  if (!found || !eligible) throw new AppError('NOT_FOUND')
  return found
}

const validAmount = (n: unknown) => typeof n === 'number' && n > 0 && Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6

function insert(clinicId: string, input: AuthorizationRequestInput, beneficiary: { id: string; name: string }, parent: Stored | null, now: Date): Stored {
  const service = db.insurerOps.services.find((s) => s.insurerId === input.insurerId && s.code === input.serviceCode)
  const refused = () => new AppError('VALIDATION_ERROR')
  if (!service || service.status !== 'ACTIVE') throw refused()
  if (lightFor(input.insurerId, { id: beneficiary.id, holderId: db.insurerOps.beneficiaries.find((b) => b.id === beneficiary.id)?.holderId ?? null }, service.code, input.expectedOn) !== 'YELLOW') throw refused()
  const guideType = input.guideType ?? parent?.guideType ?? (service.category ? GUIDE_BY_CATEGORY[service.category] ?? 'SERVICES' : undefined)
  if (!guideType) throw new AppError('VALIDATION_ERROR')
  if (db.insurerOps.authorizations.some((a) => a.clinicId === clinicId && a.beneficiaryId === beneficiary.id && a.serviceCode === service.code && a.expectedOn === input.expectedOn && PENDING.includes(a.status))) {
    throw new AppError('CONFLICT')
  }
  const insurer = db.insurers.find((i) => i.id === input.insurerId)
  const created: Stored = {
    id: newId('aut'),
    clinicId,
    beneficiaryId: beneficiary.id,
    insurerId: input.insurerId,
    insurerName: insurer?.name ?? '',
    beneficiaryName: beneficiary.name,
    serviceCode: service.code,
    serviceName: service.name,
    guideType,
    currency: db.insurerOps.modules[input.insurerId]?.currency ?? 'AOA',
    requestedAmount: input.requestedAmount,
    expectedOn: input.expectedOn,
    justification: input.justification.trim(),
    status: 'IN_REVIEW',
    closedReason: null,
    decisionNote: null,
    code: null,
    decisionDueAt: addHours(now, DECISION_HOURS),
    processId: parent?.processId ?? input.processId ?? null,
    parentRequestId: parent?.id ?? null,
    allowedActions: [],
    attachments: [],
    timeline: [
      { status: 'SUBMITTED', occurredAt: now.toISOString(), by: 'CLINIC' },
      { status: 'IN_REVIEW', occurredAt: now.toISOString(), by: 'SYSTEM' },
    ],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }
  db.insurerOps.authorizations.unshift(created)
  // Marco B fatia 4 (BR-AUT-03): as regras da seguradora podem aprovar o pedido na criação (nunca um recurso).
  evaluateAutoApproval(created, now)
  return created
}

export function createAuthorization(accountId: string, input: AuthorizationRequestInput, now: Date = new Date()) {
  return respond((): AuthorizationRequest => {
    const clinicId = clinicOf(accountId)
    requireLink(clinicId, input.insurerId)
    const identifiers = [input.cardNumber, input.qrToken, input.idDocument].filter((v) => v !== undefined && v !== '')
    const text = input.justification?.trim() ?? ''
    if (identifiers.length !== 1 || !text || text.length > 500 || !validAmount(input.requestedAmount) || !input.expectedOn || input.expectedOn < dayOf(now)) {
      throw new AppError('VALIDATION_ERROR')
    }
    const beneficiary = identify(input.insurerId, input, dayOf(now))
    return view(insert(clinicId, input, beneficiary, null, now), now, true)
  })
}

export function listAuthorizations(accountId: string, query: { status?: string; processId?: string } = {}, now: Date = new Date()) {
  return respond((): Page<AuthorizationRequest> => {
    const clinicId = clinicOf(accountId)
    const items = db.insurerOps.authorizations
      .filter((a) => a.clinicId === clinicId)
      .filter((a) => !query.processId || a.processId === query.processId)
      .filter((a) => !query.status || (query.status === 'OPEN' ? PENDING.includes(a.status) : a.status === query.status))
      .map((a) => view(a, now, false))
    return { items, nextCursor: null }
  })
}

export function getAuthorization(accountId: string, id: string, now: Date = new Date()) {
  return respond(() => view(find(clinicOf(accountId), id), now, true))
}

function write(accountId: string, id: string) {
  const clinicId = clinicOf(accountId)
  const found = find(clinicId, id)
  requireLink(clinicId, found.insurerId)
  return { clinicId, found }
}

const invalidState = () => new AppError('INVALID_STATE_TRANSITION')

export function respondAuthorization(accountId: string, id: string, message: string, now: Date = new Date()) {
  return respond((): AuthorizationRequest => {
    const { found } = write(accountId, id)
    if (found.status !== 'INFO_REQUESTED') throw invalidState()
    if (!message?.trim() || message.length > 500) throw new AppError('VALIDATION_ERROR')
    found.status = 'IN_REVIEW'
    found.infoExpiresAt = null
    found.decisionDueAt = addHours(now, DECISION_HOURS)
    found.updatedAt = now.toISOString()
    found.timeline = [...(found.timeline ?? []), { status: 'IN_REVIEW', occurredAt: now.toISOString(), by: 'CLINIC', note: message.trim() }]
    return view(found, now, true)
  })
}

export function cancelAuthorization(accountId: string, id: string, now: Date = new Date()) {
  return respond((): AuthorizationRequest => {
    const { found } = write(accountId, id)
    if (!PENDING.includes(found.status)) throw invalidState()
    found.status = 'CANCELLED'
    found.closedReason = 'CLINIC_CANCELLED'
    found.updatedAt = now.toISOString()
    found.timeline = [...(found.timeline ?? []), { status: 'CANCELLED', occurredAt: now.toISOString(), by: 'CLINIC' }]
    return view(found, now, true)
  })
}

export function appealAuthorization(accountId: string, id: string, input: { justification: string; requestedAmount?: number; expectedOn?: string }, now: Date = new Date()) {
  return respond((): AuthorizationRequest => {
    const { clinicId, found } = write(accountId, id)
    if (found.status !== 'REJECTED') throw invalidState()
    const open = view(found, now, false).allowedActions.includes('APPEAL')
    if (!open) throw new AppError('CONFLICT')
    if (!input.justification?.trim()) throw new AppError('VALIDATION_ERROR')
    const merged: AuthorizationRequestInput = {
      insurerId: found.insurerId,
      serviceCode: found.serviceCode,
      requestedAmount: input.requestedAmount ?? found.requestedAmount,
      expectedOn: input.expectedOn ?? found.expectedOn,
      justification: input.justification,
    }
    if (merged.expectedOn < dayOf(now) || !validAmount(merged.requestedAmount)) throw new AppError('VALIDATION_ERROR')
    return view(insert(clinicId, merged, { id: found.beneficiaryId, name: found.beneficiaryName }, found, now), now, true)
  })
}

export function addAuthorizationAttachment(accountId: string, id: string, input: { kind: string; name: string; size: number; type: string }, now: Date = new Date()) {
  return respond(() => {
    const { found } = write(accountId, id)
    if (!PENDING.includes(found.status)) throw invalidState()
    if (!ATTACHMENT_KINDS.includes(input.kind as AuthorizationAttachmentKind)) throw new AppError('VALIDATION_ERROR')
    if (input.size > MAX_ATTACHMENT_BYTES) throw new AppError('FILE_TOO_LARGE')
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(input.type)) throw new AppError('FILE_TYPE_NOT_ALLOWED')
    if ((found.attachments ?? []).length >= MAX_ATTACHMENTS) throw new AppError('DOCUMENT_LIMIT_EXCEEDED')
    const attachment = { id: newId('att'), kind: input.kind as AuthorizationAttachmentKind, originalName: input.name, mimeType: input.type, sizeBytes: input.size, createdAt: now.toISOString() }
    found.attachments = [...(found.attachments ?? []), attachment]
    return attachment
  })
}

export function removeAuthorizationAttachment(accountId: string, id: string, attachmentId: string) {
  return respond((): void => {
    const { found } = write(accountId, id)
    if (!found.attachments?.some((a) => a.id === attachmentId)) throw new AppError('NOT_FOUND')
    if (!PENDING.includes(found.status)) throw invalidState()
    found.attachments = found.attachments.filter((a) => a.id !== attachmentId)
  })
}

/** Só para testes: simula a decisão da seguradora (fatia 4, sem rota). */
export function decideAs(id: string, decision: 'REJECTED' | 'INFO_REQUESTED' | 'APPROVED', now: Date = new Date()): void {
  const found = db.insurerOps.authorizations.find((a) => a.id === id)
  if (!found) throw new AppError('NOT_FOUND')
  found.status = decision
  found.decisionNote = decision === 'APPROVED' ? null : decision === 'REJECTED' ? 'Fora da cobertura do plano.' : 'Falta o orçamento do serviço.'
  if (decision === 'INFO_REQUESTED') found.infoExpiresAt = addHours(now, 7 * 24)
  if (decision === 'APPROVED') {
    found.code = 'AUT-DEMO-0001'
    found.authorizedAmount = found.requestedAmount
    found.validUntil = addHours(now, 30 * 24)
  }
  found.originalDecisionAt = now.toISOString()
  found.updatedAt = now.toISOString()
}
