import { AppError } from '@/lib/errors'
import type {
  BeneficiaryStatus,
  ImportRowErrorCode,
  BeneficiaryRelationship,
  InsurerBeneficiary,
  InsurerBeneficiaryInput,
  InsurerBeneficiaryPatch,
  InsurerClaimCode,
  InsurerCompany,
  InsurerImport,
  InsurerImportRowError,
  InsurerLinkRequest,
  InsurerPlan,
  InsurerPlanCoverage,
  InsurerPlanCoverageInput,
  InsurerPolicy,
  InsurerPolicyInput,
  InsurerProvider,
  InsurerService,
  InsurerServiceInput,
  InsurerServicePatch,
  LinkRequestStatus,
  Page,
  PartnerClinic,
  PlanStatus,
  PolicyStatus,
} from '@/types/insurerOps'
import { db, newId } from '../db'
import { respond } from '../respond'

/**
 * Portal da seguradora, Fase A (`/insurance-portal/{companies,beneficiaries,imports,link-requests,
 * policies,plans,services,partner-clinics,providers}`, ADR-025). Reproduz as regras do contrato:
 * módulo desativado ⇒ NOT_FOUND; `INSURANCE_AGENT` ⇒ FORBIDDEN (§8.2b); recurso de outra seguradora
 * ⇒ NOT_FOUND; escrita de planos, serviços e clínicas só do Admin.
 */
export const MAX_IMPORT_ROWS = 5000
export const DEFAULT_LIMIT = 25

function ops(accountId: string, access: 'read' | 'ops' | 'admin' = 'read') {
  const account = db.insuranceAccounts.find((a) => a.id === accountId && a.status === 'ACTIVE')
  if (!account) throw new AppError('INVALID_CREDENTIALS')
  const isAdmin = account.role === 'INSURANCE_ADMIN'
  const isOps = isAdmin || account.role === 'BENEFICIARY_MANAGER'
  if (!isOps) throw new AppError('FORBIDDEN')
  if (access === 'admin' && !isAdmin) throw new AppError('FORBIDDEN')
  // Fase A: Gestor de beneficiários escreve em beneficiários/apólices/importações/ligações/empresas e lê o resto.
  if (!db.insurerOps.modules[account.insurerId]?.enabled) throw new AppError('NOT_FOUND')
  return { insurerId: account.insurerId, role: account.role }
}

function paginate<T>(all: T[], limit = DEFAULT_LIMIT, cursor?: string): Page<T> {
  if (limit < 1 || limit > 100) throw new AppError('VALIDATION_ERROR')
  const start = cursor ? Number(cursor) : 0
  if (!Number.isInteger(start) || start < 0) throw new AppError('VALIDATION_ERROR')
  const end = start + limit
  return { items: all.slice(start, end), nextCursor: end < all.length ? String(end) : null }
}

const strip = <T extends { insurerId: string }>({ insurerId: _i, ...rest }: T): Omit<T, 'insurerId'> => rest
const inInsurer = <T extends { insurerId: string }>(list: T[], insurerId: string) =>
  list.filter((item) => item.insurerId === insurerId)
const norm = (value: string) => value.trim().toLowerCase()
const needNote = (note: string | undefined) => {
  const text = note?.trim()
  if (!text || text.length > 500) throw new AppError('VALIDATION_ERROR')
  return text
}

interface ListQuery {
  limit?: number
  cursor?: string
}

// --- Empresas (UC-SEG-01) ---

export function listCompanies(accountId: string, query: ListQuery & { status?: InsurerCompany['status'] } = {}) {
  return respond(() => {
    const { insurerId } = ops(accountId)
    const all = inInsurer(db.insurerOps.companies, insurerId)
      .filter((c) => !query.status || c.status === query.status)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-PT'))
    return paginate(all.map(strip), query.limit, query.cursor)
  })
}

export function createCompany(accountId: string, input: { name: string; taxId: string }) {
  return respond((): InsurerCompany => {
    const { insurerId } = ops(accountId, 'ops')
    const name = input.name.trim()
    const taxId = input.taxId.trim()
    if (!name || name.length > 200 || !taxId || taxId.length > 40) throw new AppError('VALIDATION_ERROR')
    if (inInsurer(db.insurerOps.companies, insurerId).some((c) => c.taxId === taxId)) throw new AppError('CONFLICT')
    const company = { id: newId('cmp'), insurerId, name, taxId, status: 'ACTIVE' as const, createdAt: new Date().toISOString() }
    db.insurerOps.companies.push(company)
    return strip(company)
  })
}

export function updateCompany(accountId: string, id: string, patch: { name?: string; status?: InsurerCompany['status'] }) {
  return respond((): InsurerCompany => {
    const { insurerId } = ops(accountId, 'ops')
    const company = inInsurer(db.insurerOps.companies, insurerId).find((c) => c.id === id)
    if (!company) throw new AppError('NOT_FOUND')
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new AppError('VALIDATION_ERROR')
      company.name = patch.name.trim()
    }
    if (patch.status) company.status = patch.status
    return strip(company)
  })
}

// --- Beneficiários (UC-SEG-02) ---

function ownBeneficiary(insurerId: string, id: string) {
  const found = inInsurer(db.insurerOps.beneficiaries, insurerId).find((b) => b.id === id)
  if (!found) throw new AppError('NOT_FOUND')
  return found
}

function nextCardNumber(insurerId: string): string {
  const count = inInsurer(db.insurerOps.beneficiaries, insurerId).length + 1
  return `AUR-${String(count).padStart(6, '0')}`
}

export function listBeneficiaries(
  accountId: string,
  query: ListQuery & { q?: string; status?: BeneficiaryStatus; companyId?: string; holderId?: string; relationship?: BeneficiaryRelationship } = {},
) {
  return respond(() => {
    const { insurerId } = ops(accountId)
    const q = query.q ? norm(query.q) : ''
    const all = inInsurer(db.insurerOps.beneficiaries, insurerId)
      .filter((b) => !query.status || b.status === query.status)
      .filter((b) => !query.companyId || b.companyId === query.companyId)
      .filter((b) => !query.holderId || b.holderId === query.holderId)
      .filter((b) => !query.relationship || b.relationship === query.relationship)
      // Nome ou nº de cartão por parte; o documento só por correspondência exata (contrato).
      .filter((b) => !q || norm(b.name).includes(q) || norm(b.cardNumber).includes(q) || norm(b.idDocumentNumber) === q)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-PT'))
    return paginate(all.map(strip), query.limit, query.cursor)
  })
}

export function createBeneficiary(accountId: string, input: InsurerBeneficiaryInput) {
  return respond((): InsurerBeneficiary => {
    const { insurerId } = ops(accountId, 'ops')
    const name = input.name.trim()
    if (!name || !input.idDocumentType.trim() || !input.idDocumentNumber.trim() || !input.birthDate) {
      throw new AppError('VALIDATION_ERROR')
    }
    const isHolder = input.relationship === 'HOLDER'
    if (isHolder === Boolean(input.holderId)) throw new AppError('VALIDATION_ERROR')
    if (input.holderId) {
      const holder = ownBeneficiary(insurerId, input.holderId)
      if (holder.relationship !== 'HOLDER') throw new AppError('VALIDATION_ERROR')
    }
    if (input.companyId && !inInsurer(db.insurerOps.companies, insurerId).some((c) => c.id === input.companyId)) {
      throw new AppError('VALIDATION_ERROR')
    }
    const dup = inInsurer(db.insurerOps.beneficiaries, insurerId).some(
      (b) => b.idDocumentType === input.idDocumentType.trim() && norm(b.idDocumentNumber) === norm(input.idDocumentNumber),
    )
    if (dup) throw new AppError('CONFLICT')
    const record = {
      id: newId('ben'),
      insurerId,
      companyId: input.companyId ?? null,
      holderId: input.holderId ?? null,
      name,
      idDocumentType: input.idDocumentType.trim(),
      idDocumentNumber: input.idDocumentNumber.trim(),
      birthDate: input.birthDate,
      relationship: input.relationship,
      cardNumber: nextCardNumber(insurerId),
      status: 'PENDING' as const, // BR-SEG-17: nunca ativo sem validação
      linked: false,
      statusNote: null,
      createdAt: new Date().toISOString(),
    }
    db.insurerOps.beneficiaries.push(record)
    return strip(record)
  })
}

export function getBeneficiary(accountId: string, id: string) {
  return respond(() => strip(ownBeneficiary(ops(accountId).insurerId, id)))
}

export function updateBeneficiary(accountId: string, id: string, patch: InsurerBeneficiaryPatch) {
  return respond((): InsurerBeneficiary => {
    const { insurerId } = ops(accountId, 'ops')
    const record = ownBeneficiary(insurerId, id)
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new AppError('VALIDATION_ERROR')
      record.name = patch.name.trim()
    }
    if (patch.birthDate) record.birthDate = patch.birthDate
    if (patch.companyId !== undefined) {
      if (patch.companyId && !inInsurer(db.insurerOps.companies, insurerId).some((c) => c.id === patch.companyId)) {
        throw new AppError('VALIDATION_ERROR')
      }
      record.companyId = patch.companyId
    }
    return strip(record)
  })
}

const BENEFICIARY_TRANSITIONS: Record<BeneficiaryStatus, BeneficiaryStatus[]> = {
  PENDING: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['SUSPENDED', 'CANCELLED'],
  SUSPENDED: ['ACTIVE', 'CANCELLED'],
  CANCELLED: [],
}

export function setBeneficiaryStatus(accountId: string, id: string, status: BeneficiaryStatus, note?: string) {
  return respond((): InsurerBeneficiary => {
    const { insurerId } = ops(accountId, 'ops')
    const record = ownBeneficiary(insurerId, id)
    if (status === 'PENDING') throw new AppError('VALIDATION_ERROR')
    const needsNote = status === 'SUSPENDED' || status === 'CANCELLED'
    const text = needsNote ? needNote(note) : null
    if (!BENEFICIARY_TRANSITIONS[record.status].includes(status)) throw new AppError('CONFLICT')
    record.status = status
    record.statusNote = text
    return strip(record)
  })
}

/** O código vai em claro uma única vez; só um hash ficaria guardado (BR-SEG-20). */
export function issueClaimCode(accountId: string, id: string) {
  return respond((): InsurerClaimCode => {
    const { insurerId } = ops(accountId, 'ops')
    const record = ownBeneficiary(insurerId, id)
    if (record.status === 'CANCELLED') throw new AppError('CONFLICT')
    // Como o backend: 8 caracteres de um alfabeto sem 0 O 1 I L, apresentados «XXXX-XXXX»; guardado normalizado.
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
    const raw = Array.from(crypto.getRandomValues(new Uint8Array(8)), (n) => alphabet[n % alphabet.length]).join('')
    const code = `${raw.slice(0, 4)}-${raw.slice(4)}`
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString()
    // Um novo código invalida o anterior (BR-SEG-32).
    db.insurerOps.claimCodes = db.insurerOps.claimCodes.filter((c) => !(c.insurerId === insurerId && c.beneficiaryId === id))
    db.insurerOps.claimCodes.push({ insurerId, beneficiaryId: id, code: raw, expiresAt, used: false })
    return { code, expiresAt }
  })
}

// --- Importação (BR-SEG-17) ---

const RELATIONSHIPS = ['HOLDER', 'SPOUSE', 'CHILD', 'OTHER']

function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '')
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? ''
  const sep = firstLine.split(';').length > firstLine.split(',').length ? ';' : ','
  return clean
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => line.split(sep).map((cell) => cell.trim().replace(/^"|"$/g, '')))
}

/** CSV (UTF-8, `,` ou `;`). O XLSX só é tratado pela API real: o mock não o descodifica. */
export function createImport(accountId: string, file: { name: string; text: string }) {
  return respond((): InsurerImport => {
    const { insurerId } = ops(accountId, 'ops')
    if (!/\.csv$/i.test(file.name)) throw new AppError('FILE_TYPE_NOT_ALLOWED')
    const [header = [], ...rows] = parseCsv(file.text)
    if (rows.length < 1 || rows.length > MAX_IMPORT_ROWS) throw new AppError('VALIDATION_ERROR')
    const col = (name: string) => header.indexOf(name)
    if (['name', 'idDocumentType', 'idDocumentNumber', 'birthDate', 'relationship'].some((c) => col(c) < 0)) {
      throw new AppError('VALIDATION_ERROR')
    }
    const errors: InsurerImportRowError[] = []
    const valid: InsurerImport['preview'] = []
    const records: Array<Omit<InsurerBeneficiary, 'id' | 'cardNumber' | 'status' | 'linked' | 'createdAt'>> = []
    const seen = new Set<string>()
    const existing = new Set(
      inInsurer(db.insurerOps.beneficiaries, insurerId).map((b) => `${b.idDocumentType}|${norm(b.idDocumentNumber)}`),
    )
    const holdersInFile = new Set(rows.map((r) => norm(r[col('idDocumentNumber')] ?? '')))
    let duplicateRows = 0
    let errorRows = 0
    rows.forEach((cells, index) => {
      const row = index + 2
      const get = (name: string) => (col(name) < 0 ? '' : (cells[col(name)] ?? ''))
      const fail = (field: string, code: ImportRowErrorCode) => {
        errors.push({ row, field, code, message: undefined })
        return false
      }
      const key = `${get('idDocumentType')}|${norm(get('idDocumentNumber'))}`
      const checks = [
        () => (get('name') ? true : fail('name', 'REQUIRED')),
        () => (get('idDocumentType') ? true : fail('idDocumentType', 'REQUIRED')),
        () => (get('idDocumentNumber') ? true : fail('idDocumentNumber', 'REQUIRED')),
        () => (/^\d{4}-\d{2}-\d{2}$/.test(get('birthDate')) ? true : fail('birthDate', 'INVALID_FORMAT')),
        () => (RELATIONSHIPS.includes(get('relationship')) ? true : fail('relationship', 'INVALID_VALUE')),
        () => {
          if (seen.has(key)) {
            duplicateRows += 1
            return fail('idDocumentNumber', 'DUPLICATE_IN_FILE')
          }
          if (existing.has(key)) {
            duplicateRows += 1
            return fail('idDocumentNumber', 'DUPLICATE_EXISTING')
          }
          return true
        },
        () => {
          if (get('relationship') === 'HOLDER') return true
          const holder = norm(get('holderIdDocumentNumber'))
          if (!holder) return fail('holderIdDocumentNumber', 'REQUIRED')
          const known = inInsurer(db.insurerOps.beneficiaries, insurerId).some((b) => norm(b.idDocumentNumber) === holder)
          return known || holdersInFile.has(holder) ? true : fail('holderIdDocumentNumber', 'HOLDER_NOT_FOUND')
        },
        () => {
          const taxId = get('companyTaxId')
          if (!taxId) return true
          return inInsurer(db.insurerOps.companies, insurerId).some((c) => c.taxId === taxId)
            ? true
            : fail('companyTaxId', 'COMPANY_NOT_FOUND')
        },
      ]
      for (const check of checks) {
        if (!check()) {
          errorRows += 1
          return
        }
      }
      seen.add(key)
      valid.push({
        row,
        name: get('name'),
        idDocumentType: get('idDocumentType'),
        idDocumentNumber: get('idDocumentNumber'),
        birthDate: get('birthDate'),
        relationship: get('relationship') as InsurerBeneficiary['relationship'],
      })
      const holder = inInsurer(db.insurerOps.beneficiaries, insurerId).find(
        (b) => norm(b.idDocumentNumber) === norm(get('holderIdDocumentNumber')),
      )
      const company = inInsurer(db.insurerOps.companies, insurerId).find((c) => c.taxId === get('companyTaxId'))
      records.push({
        name: get('name'),
        idDocumentType: get('idDocumentType'),
        idDocumentNumber: get('idDocumentNumber'),
        birthDate: get('birthDate'),
        relationship: get('relationship') as InsurerBeneficiary['relationship'],
        holderId: holder?.id ?? null,
        companyId: company?.id ?? null,
      })
    })
    const batch = {
      id: newId('imp'),
      insurerId,
      format: 'CSV' as const,
      status: 'PREVIEW' as const,
      rowCount: rows.length,
      validRows: valid.length,
      errorRows,
      duplicateRows,
      importedRows: null,
      errors: errors.slice(0, 500),
      errorsTruncated: errors.length > 500,
      preview: valid.slice(0, 50),
      createdAt: new Date().toISOString(),
      validRecords: records,
    }
    db.insurerOps.imports.push(batch)
    const { validRecords: _v, insurerId: _i, ...view } = batch
    return view
  })
}

function ownImport(insurerId: string, id: string) {
  const found = inInsurer(db.insurerOps.imports, insurerId).find((i) => i.id === id)
  if (!found) throw new AppError('NOT_FOUND')
  return found
}

const importView = ({ validRecords: _v, insurerId: _i, ...view }: ReturnType<typeof ownImport>): InsurerImport => view

export function getImport(accountId: string, id: string) {
  return respond(() => importView(ownImport(ops(accountId, 'ops').insurerId, id)))
}

export function cancelImport(accountId: string, id: string) {
  return respond(() => {
    const batch = ownImport(ops(accountId, 'ops').insurerId, id)
    if (batch.status !== 'PREVIEW') throw new AppError('CONFLICT')
    batch.status = 'CANCELLED'
    batch.validRecords = []
    return undefined
  })
}

/** Grava as linhas válidas (PENDING); inválidas/duplicadas só contam (BR-SEG-17). */
export function commitImport(accountId: string, id: string) {
  return respond((): InsurerImport => {
    const { insurerId } = ops(accountId, 'ops')
    const batch = ownImport(insurerId, id)
    if (batch.status !== 'PREVIEW') throw new AppError('CONFLICT')
    for (const record of batch.validRecords) {
      db.insurerOps.beneficiaries.push({
        ...record,
        id: newId('ben'),
        insurerId,
        cardNumber: nextCardNumber(insurerId),
        status: 'PENDING',
        linked: false,
        statusNote: null,
        createdAt: new Date().toISOString(),
      })
    }
    batch.status = 'COMMITTED'
    batch.importedRows = batch.validRecords.length
    batch.validRecords = []
    return importView(batch)
  })
}

// --- Ligações cartão ↔ paciente (BR-SEG-20) ---

/** A seguradora nunca vê a família nem o membro do paciente (privacidade, ADR-025 §3). */
const stripLink = ({ insurerId: _i, familyId: _f, memberId: _m, ...rest }: (typeof db.insurerOps.linkRequests)[number]): InsurerLinkRequest => rest

export function listLinkRequests(accountId: string, query: ListQuery & { status?: LinkRequestStatus } = {}) {
  return respond(() => {
    const { insurerId } = ops(accountId)
    const status = query.status ?? 'PENDING'
    const all = inInsurer(db.insurerOps.linkRequests, insurerId)
      .filter((l) => l.status === status)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
    return paginate(all.map(stripLink), query.limit, query.cursor)
  })
}

function decideLink(accountId: string, id: string, status: 'CONFIRMED' | 'REJECTED', note?: string): InsurerLinkRequest {
  const { insurerId } = ops(accountId, 'ops')
  const link = inInsurer(db.insurerOps.linkRequests, insurerId).find((l) => l.id === id)
  if (!link) throw new AppError('NOT_FOUND')
  const text = status === 'REJECTED' ? needNote(note) : null
  if (link.status !== 'PENDING') throw new AppError('CONFLICT')
  link.status = status
  link.decidedAt = new Date().toISOString()
  link.decisionNote = text
  if (status === 'CONFIRMED') {
    const beneficiary = inInsurer(db.insurerOps.beneficiaries, insurerId).find((b) => b.id === link.beneficiaryId)
    if (beneficiary) beneficiary.linked = true
  }
  return stripLink(link)
}

export const confirmLinkRequest = (accountId: string, id: string) => respond(() => decideLink(accountId, id, 'CONFIRMED'))
export const rejectLinkRequest = (accountId: string, id: string, note: string) =>
  respond(() => decideLink(accountId, id, 'REJECTED', note))

// --- Planos (UC-SEG-04) e serviços (BR-SEG-22) ---

function ownPlan(insurerId: string, id: string) {
  const found = inInsurer(db.insurerOps.plans, insurerId).find((p) => p.id === id)
  if (!found) throw new AppError('NOT_FOUND')
  return found
}

const coverageCount = (planId: string) => db.insurerOps.coverages.filter((c) => c.planId === planId).length
const planView = (plan: ReturnType<typeof ownPlan>): InsurerPlan => ({ ...strip(plan), coverageCount: coverageCount(plan.id) })

export function listPlans(accountId: string, query: ListQuery & { status?: PlanStatus; name?: string } = {}) {
  return respond(() => {
    const { insurerId } = ops(accountId)
    const name = query.name ? norm(query.name) : ''
    const all = inInsurer(db.insurerOps.plans, insurerId)
      .filter((p) => !query.status || p.status === query.status)
      .filter((p) => !name || norm(p.name).includes(name))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-PT') || b.version - a.version)
    return paginate(all.map(planView), query.limit, query.cursor)
  })
}

export function createPlan(accountId: string, input: { name: string }) {
  return respond((): InsurerPlan => {
    const { insurerId } = ops(accountId, 'admin')
    const name = input.name.trim()
    if (!name || name.length > 120) throw new AppError('VALIDATION_ERROR')
    if (inInsurer(db.insurerOps.plans, insurerId).some((p) => norm(p.name) === norm(name) && p.version === 1)) {
      throw new AppError('CONFLICT')
    }
    const plan = { id: newId('pln'), insurerId, name, version: 1, status: 'DRAFT' as const, coverageCount: 0, createdAt: new Date().toISOString() }
    db.insurerOps.plans.push(plan)
    return planView(plan)
  })
}

export function getPlan(accountId: string, id: string) {
  return respond(() => planView(ownPlan(ops(accountId).insurerId, id)))
}

export function setPlanStatus(accountId: string, id: string, status: 'ACTIVE' | 'ARCHIVED') {
  return respond((): InsurerPlan => {
    const plan = ownPlan(ops(accountId, 'admin').insurerId, id)
    if (status === 'ACTIVE') {
      if (plan.status !== 'DRAFT') throw new AppError('CONFLICT')
      if (coverageCount(plan.id) < 1) throw new AppError('CONFLICT')
    } else if (plan.status !== 'ACTIVE') {
      throw new AppError('CONFLICT')
    }
    plan.status = status
    return planView(plan)
  })
}

export function newPlanVersion(accountId: string, id: string) {
  return respond((): InsurerPlan => {
    const { insurerId } = ops(accountId, 'admin')
    const source = ownPlan(insurerId, id)
    if (source.status !== 'ACTIVE') throw new AppError('CONFLICT')
    if (inInsurer(db.insurerOps.plans, insurerId).some((p) => p.name === source.name && p.status === 'DRAFT')) {
      throw new AppError('CONFLICT')
    }
    const next = {
      id: newId('pln'),
      insurerId,
      name: source.name,
      version: Math.max(...inInsurer(db.insurerOps.plans, insurerId).filter((p) => p.name === source.name).map((p) => p.version)) + 1,
      status: 'DRAFT' as const,
      coverageCount: 0,
      createdAt: new Date().toISOString(),
    }
    db.insurerOps.plans.push(next)
    for (const coverage of db.insurerOps.coverages.filter((c) => c.planId === source.id)) {
      db.insurerOps.coverages.push({ ...coverage, planId: next.id })
    }
    return planView(next)
  })
}

export function listPlanCoverages(accountId: string, id: string) {
  return respond((): InsurerPlanCoverage[] => {
    const plan = ownPlan(ops(accountId).insurerId, id)
    return db.insurerOps.coverages
      .filter((c) => c.planId === plan.id)
      .map(({ planId: _p, insurerId: _i, ...rest }) => rest)
      .sort((a, b) => a.serviceName.localeCompare(b.serviceName, 'pt-PT'))
  })
}

export function replacePlanCoverages(accountId: string, id: string, items: InsurerPlanCoverageInput[]) {
  return respond((): InsurerPlanCoverage[] => {
    const { insurerId } = ops(accountId, 'admin')
    const plan = ownPlan(insurerId, id)
    if (plan.status !== 'DRAFT') throw new AppError('CONFLICT')
    if (new Set(items.map((i) => i.serviceId)).size !== items.length || items.length > 1000) throw new AppError('VALIDATION_ERROR')
    const services = inInsurer(db.insurerOps.services, insurerId)
    const rows = items.map((item) => {
      const service = services.find((s) => s.id === item.serviceId)
      if (!service) throw new AppError('VALIDATION_ERROR')
      if (item.copayPct < 0 || item.copayPct > 100 || item.waitingDays < 0 || (item.limitPerYear ?? 0) < 0) {
        throw new AppError('VALIDATION_ERROR')
      }
      return {
        planId: plan.id,
        insurerId,
        serviceId: service.id,
        serviceCode: service.code,
        serviceName: service.name,
        covered: item.covered,
        copayPct: item.copayPct,
        limitPerYear: item.limitPerYear,
        waitingDays: item.waitingDays,
        requiresAuthorization: item.requiresAuthorization,
      }
    })
    db.insurerOps.coverages = [...db.insurerOps.coverages.filter((c) => c.planId !== plan.id), ...rows]
    return rows.map(({ planId: _p, insurerId: _i, ...rest }) => rest)
  })
}

export function listServices(accountId: string, query: ListQuery & { q?: string; status?: InsurerService['status'] } = {}) {
  return respond(() => {
    const { insurerId } = ops(accountId)
    const q = query.q ? norm(query.q) : ''
    const all = inInsurer(db.insurerOps.services, insurerId)
      .filter((s) => !query.status || s.status === query.status)
      .filter((s) => !q || norm(s.name).includes(q) || norm(s.code).includes(q))
      .sort((a, b) => a.code.localeCompare(b.code, 'pt-PT'))
    return paginate(all.map(strip), query.limit, query.cursor)
  })
}

export function createService(accountId: string, input: InsurerServiceInput) {
  return respond((): InsurerService => {
    const { insurerId } = ops(accountId, 'admin')
    const code = input.code.trim()
    const name = input.name.trim()
    if (!code || code.length > 40 || !name || name.length > 200 || (input.category?.length ?? 0) > 80) {
      throw new AppError('VALIDATION_ERROR')
    }
    if (inInsurer(db.insurerOps.services, insurerId).some((s) => norm(s.code) === norm(code))) throw new AppError('CONFLICT')
    const service = { id: newId('svc'), insurerId, code, name, category: input.category?.trim() || null, status: 'ACTIVE' as const }
    db.insurerOps.services.push(service)
    return strip(service)
  })
}

export function updateService(accountId: string, id: string, patch: InsurerServicePatch) {
  return respond((): InsurerService => {
    const { insurerId } = ops(accountId, 'admin')
    const service = inInsurer(db.insurerOps.services, insurerId).find((s) => s.id === id)
    if (!service) throw new AppError('NOT_FOUND')
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new AppError('VALIDATION_ERROR')
      service.name = patch.name.trim()
    }
    if (patch.category !== undefined) service.category = patch.category?.trim() || null
    if (patch.status) service.status = patch.status
    return strip(service)
  })
}

// --- Apólices (UC-SEG-03) ---

function ownPolicy(insurerId: string, id: string) {
  const found = inInsurer(db.insurerOps.policies, insurerId).find((p) => p.id === id)
  if (!found) throw new AppError('NOT_FOUND')
  return found
}

export function listPolicies(
  accountId: string,
  query: ListQuery & { status?: PolicyStatus; companyId?: string; holderId?: string; q?: string } = {},
) {
  return respond(() => {
    const { insurerId } = ops(accountId)
    const q = query.q ? norm(query.q) : ''
    const all = inInsurer(db.insurerOps.policies, insurerId)
      .filter((p) => !query.status || p.status === query.status)
      .filter((p) => !query.companyId || p.companyId === query.companyId)
      .filter((p) => !query.holderId || p.holderId === query.holderId)
      .filter((p) => !q || norm(p.number).includes(q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.number.localeCompare(b.number))
    return paginate(all.map(strip), query.limit, query.cursor)
  })
}

export function createPolicy(accountId: string, input: InsurerPolicyInput) {
  return respond((): InsurerPolicy => {
    const { insurerId } = ops(accountId, 'ops')
    const plan = ownPlan(insurerId, input.planId)
    const holder = ownBeneficiary(insurerId, input.holderId)
    const number = input.number.trim()
    if (!number || number.length > 60 || holder.relationship !== 'HOLDER' || input.validFrom > input.validTo) {
      throw new AppError('VALIDATION_ERROR')
    }
    if (input.companyId && !inInsurer(db.insurerOps.companies, insurerId).some((c) => c.id === input.companyId)) {
      throw new AppError('VALIDATION_ERROR')
    }
    if (inInsurer(db.insurerOps.policies, insurerId).some((p) => norm(p.number) === norm(number))) throw new AppError('CONFLICT')
    const policy = {
      id: newId('pol'),
      insurerId,
      number,
      planId: plan.id,
      planName: plan.name,
      planVersion: plan.version,
      companyId: input.companyId ?? null,
      holderId: holder.id,
      validFrom: input.validFrom,
      validTo: input.validTo,
      status: 'DRAFT' as const,
      statusNote: null,
      createdAt: new Date().toISOString(),
    }
    db.insurerOps.policies.push(policy)
    return strip(policy)
  })
}

export function getPolicy(accountId: string, id: string) {
  return respond(() => strip(ownPolicy(ops(accountId).insurerId, id)))
}

const POLICY_TRANSITIONS: Record<PolicyStatus, PolicyStatus[]> = {
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['SUSPENDED', 'CANCELLED'],
  SUSPENDED: ['ACTIVE', 'CANCELLED'],
  EXPIRED: [],
  CANCELLED: [],
}

export function setPolicyStatus(accountId: string, id: string, status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED', note?: string) {
  return respond((): InsurerPolicy => {
    const { insurerId } = ops(accountId, 'ops')
    const policy = ownPolicy(insurerId, id)
    const text = status === 'ACTIVE' ? null : needNote(note)
    if (!POLICY_TRANSITIONS[policy.status].includes(status)) throw new AppError('CONFLICT')
    if (policy.status === 'DRAFT' && status === 'ACTIVE' && ownPlan(insurerId, policy.planId).status !== 'ACTIVE') {
      throw new AppError('CONFLICT')
    }
    policy.status = status
    policy.statusNote = text
    return strip(policy)
  })
}

// --- Clínicas parceiras e prestadores (só Admin) ---

export function listPartnerClinics(accountId: string, query: ListQuery & { q?: string } = {}) {
  return respond((): Page<PartnerClinic> => {
    ops(accountId, 'admin')
    const q = query.q ? norm(query.q) : ''
    const all = db.clinics
      .filter((c) => c.type === 'PARTNER' && c.status === 'ACTIVE')
      .map((c) => ({ id: c.id, name: c.displayName ?? c.name }))
      .filter((c) => !q || norm(c.name).includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-PT'))
    return paginate(all, query.limit, query.cursor)
  })
}

export function listProviders(accountId: string, query: ListQuery & { status?: InsurerProvider['status'] } = {}) {
  return respond(() => {
    const { insurerId } = ops(accountId)
    const all = inInsurer(db.insurerOps.providers, insurerId).filter((p) => !query.status || p.status === query.status)
    return paginate(all.map(strip), query.limit, query.cursor)
  })
}

export function createProvider(accountId: string, clinicId: string) {
  return respond((): InsurerProvider => {
    const { insurerId } = ops(accountId, 'admin')
    const clinic = db.clinics.find((c) => c.id === clinicId && c.type === 'PARTNER' && c.status === 'ACTIVE')
    if (!clinic) throw new AppError('NOT_FOUND')
    if (inInsurer(db.insurerOps.providers, insurerId).some((p) => p.clinicId === clinicId)) throw new AppError('CONFLICT')
    const provider = { id: newId('prv'), insurerId, clinicId, name: clinic.displayName ?? clinic.name, status: 'ACTIVE' as const }
    db.insurerOps.providers.push(provider)
    return strip(provider)
  })
}

export function setProviderStatus(accountId: string, id: string, status: InsurerProvider['status']) {
  return respond((): InsurerProvider => {
    const { insurerId } = ops(accountId, 'admin')
    const provider = inInsurer(db.insurerOps.providers, insurerId).find((p) => p.id === id)
    if (!provider) throw new AppError('NOT_FOUND')
    provider.status = status
    return strip(provider)
  })
}
