import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { professionalSessionStore } from '@/lib/storage'
import type { Weekday } from '@/types/professional'
import { professionalDb, resetProfessionalDb, type MockProfessional } from '../professionalDb'
import * as admin from './professionalAdmin'
import * as portal from './professionalPortal'

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

const DAY = 86_400_000
const ALL_DAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7]
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString()

function rec(id: string): MockProfessional {
  const found = professionalDb.professionals.find((p) => p.id === id)
  if (!found) throw new Error(`conta de teste ${id} em falta`)
  return found
}

function signIn(id: string) {
  professionalSessionStore.setAccountId(id)
}

beforeEach(() => {
  resetProfessionalDb()
  window.sessionStorage.clear()
})

// ───── Fila e detalhe (UC-MKT-06) ─────

describe('fila de validação', () => {
  it('omissão: só PENDING_REVIEW (pro_fila)', async () => {
    const page = await admin.adminListProfessionals()
    expect(page.items.map((i) => i.id)).toEqual(['pro_fila'])
    expect(page.nextCursor).toBeNull()
  })

  it('filtra por estado', async () => {
    expect((await admin.adminListProfessionals({ status: 'APPROVED' })).items.map((i) => i.id)).toEqual(['pro_aprovada'])
    expect((await admin.adminListProfessionals({ status: 'SUSPENDED' })).items.map((i) => i.id)).toEqual(['pro_suspensa'])
  })

  it('filtra por categoria da especialidade', async () => {
    expect((await admin.adminListProfessionals({ category: 'HEALTH' })).items.map((i) => i.id)).toEqual(['pro_fila'])
    expect(await admin.adminListProfessionals({ category: 'WELLNESS' })).toMatchObject({ items: [] })
  })

  it('pesquisa por nome ou e-mail, sem distinguir maiúsculas; 1 letra ⇒ VALIDATION_ERROR', async () => {
    expect((await admin.adminListProfessionals({ q: 'MENDES' })).items.map((i) => i.id)).toEqual(['pro_fila'])
    expect((await admin.adminListProfessionals({ q: 'joao.mendes' })).items.map((i) => i.id)).toEqual(['pro_fila'])
    expect(await code(admin.adminListProfessionals({ q: 'J' }))).toBe('VALIDATION_ERROR')
  })

  it('cursor inválido ⇒ VALIDATION_ERROR', async () => {
    expect(await code(admin.adminListProfessionals({ cursor: '-1' }))).toBe('VALIDATION_ERROR')
  })

  it('a fila não inclui contas ainda não verificadas, mesmo em PENDING_REVIEW', async () => {
    await portal.professionalRegister({ email: 'nova@exemplo.ao', password: 'palavra-passe-longa', termsVersion: '2026-11' })
    const novo = professionalDb.professionals.find((p) => p.email === 'nova@exemplo.ao')!
    novo.validationStatus = 'PENDING_REVIEW'
    expect((await admin.adminListProfessionals()).items.map((i) => i.id)).toEqual(['pro_fila'])
  })
})

describe('detalhe do profissional', () => {
  it('nunca contém paymentInstructions, ofertas, regras nem horários', async () => {
    const detail = await admin.adminGetProfessional('pro_fila')
    const keys = Object.keys(detail)
    expect(keys).not.toContain('paymentInstructions')
    expect(keys).not.toContain('offers')
    expect(keys).not.toContain('rules')
    expect(keys).not.toContain('slots')
    expect(JSON.stringify(detail)).not.toContain('IBAN')
  })

  it('o detalhe de uma conta com ofertas não expõe as ofertas nem a nota', async () => {
    const detail = await admin.adminGetProfessional('pro_aprovada')
    expect(Object.keys(detail)).not.toContain('offers')
    const text = JSON.stringify(detail)
    expect(text).not.toContain('ofr_ap_1')
    expect(text).not.toContain('Restinga')
  })

  it('credenciais sem nome do ficheiro nem estado interno; histórico mais recente primeiro', async () => {
    const detail = await admin.adminGetProfessional('pro_aprovada')
    for (const c of detail.credentials) {
      expect(Object.keys(c)).not.toContain('fileName')
      expect(Object.keys(c)).not.toContain('ticks')
    }
    expect(detail.history.map((h) => h.action)).toEqual(['APPROVED', 'SUBMITTED'])
  })

  it('id inexistente ou conta não verificada ⇒ NOT_FOUND', async () => {
    expect(await code(admin.adminGetProfessional('pro_nao_existe'))).toBe('NOT_FOUND')
    await portal.professionalRegister({ email: 'nova@exemplo.ao', password: 'palavra-passe-longa', termsVersion: '2026-11' })
    const id = professionalDb.professionals.find((p) => p.email === 'nova@exemplo.ao')!.id
    expect(await code(admin.adminGetProfessional(id))).toBe('NOT_FOUND')
  })
})

// ───── Decisões (UC-MKT-06, UC-MKT-10) ─────

describe('decisões do admin', () => {
  it('APPROVE de pro_fila ⇒ APPROVED, com histórico do admin e horários das regras já guardadas', async () => {
    signIn('pro_fila')
    const offer = await portal.createProfessionalOffer({ specialtyId: 'spc_psico', method: 'VIDEO', durationMinutes: 30, priceKz: 5000 })
    const created = await portal.createProfessionalScheduleRule({
      offerId: offer.id,
      weekdays: ALL_DAYS,
      startTime: '09:00',
      endTime: '10:00',
    })
    expect(created.generation.created).toBe(0) // ainda não aprovado (BR-MKT-25)

    const detail = await admin.adminDecideProfessional('pro_fila', { decision: 'APPROVE' })
    expect(detail.validationStatus).toBe('APPROVED')
    expect(detail.approvedAt).toBeDefined()
    expect(detail.history[0]).toMatchObject({ action: 'APPROVED', fromStatus: 'PENDING_REVIEW', toStatus: 'APPROVED', actor: 'PLATFORM_ADMIN' })

    signIn('pro_fila')
    const slots = await portal.listProfessionalSlots(inDays(0), inDays(14))
    expect(slots.length).toBeGreaterThan(0)
    expect(slots.every((s) => s.offerId === offer.id)).toBe(true)
  })

  it('APPROVE com credencial caducada ou infetada ⇒ VALIDATION_ERROR', async () => {
    rec('pro_fila').credentials.find((c) => c.id === 'crd_fila_lic')!.validUntil = '2020-01-01'
    expect(await code(admin.adminDecideProfessional('pro_fila', { decision: 'APPROVE' }))).toBe('VALIDATION_ERROR')
    expect((await admin.adminGetProfessional('pro_fila')).validationStatus).toBe('PENDING_REVIEW')

    resetProfessionalDb()
    rec('pro_fila').credentials.find((c) => c.id === 'crd_fila_lic')!.scanStatus = 'INFECTED'
    expect(await code(admin.adminDecideProfessional('pro_fila', { decision: 'APPROVE' }))).toBe('VALIDATION_ERROR')
  })

  it('REJECT, REQUEST_INFO e SUSPEND sem motivo ⇒ VALIDATION_ERROR; motivo > 500 ⇒ VALIDATION_ERROR', async () => {
    expect(await code(admin.adminDecideProfessional('pro_fila', { decision: 'REJECT' }))).toBe('VALIDATION_ERROR')
    expect(await code(admin.adminDecideProfessional('pro_fila', { decision: 'REQUEST_INFO', reason: '   ' }))).toBe('VALIDATION_ERROR')
    expect(await code(admin.adminDecideProfessional('pro_fila', { decision: 'REJECT', reason: 'x'.repeat(501) }))).toBe('VALIDATION_ERROR')
    expect(await code(admin.adminDecideProfessional('pro_aprovada', { decision: 'SUSPEND' }))).toBe('VALIDATION_ERROR')
    expect((await admin.adminGetProfessional('pro_fila')).validationStatus).toBe('PENDING_REVIEW')
  })

  it('REJECT com motivo ⇒ REJECTED e motivo visível; depois só REQUEST_INFO é possível', async () => {
    const detail = await admin.adminDecideProfessional('pro_fila', { decision: 'REJECT', reason: 'Cédula ilegível.' })
    expect(detail).toMatchObject({ validationStatus: 'REJECTED', statusReason: 'Cédula ilegível.' })
    expect(await code(admin.adminDecideProfessional('pro_fila', { decision: 'REJECT', reason: 'Outra vez.' }))).toBe('INVALID_STATE_TRANSITION')
    expect(await code(admin.adminDecideProfessional('pro_fila', { decision: 'APPROVE' }))).toBe('INVALID_STATE_TRANSITION')
    expect(await code(admin.adminDecideProfessional('pro_fila', { decision: 'REQUEST_INFO', reason: 'Falta a cédula.' }))).toBe('OK')
  })

  it('decidir sobre um estado que já mudou (APPROVE duas vezes) ⇒ INVALID_STATE_TRANSITION', async () => {
    await admin.adminDecideProfessional('pro_fila', { decision: 'APPROVE' })
    expect(await code(admin.adminDecideProfessional('pro_fila', { decision: 'APPROVE' }))).toBe('INVALID_STATE_TRANSITION')
  })

  it('estados sem decisões (DRAFT) ⇒ INVALID_STATE_TRANSITION', async () => {
    expect(await code(admin.adminDecideProfessional('pro_demo', { decision: 'APPROVE' }))).toBe('INVALID_STATE_TRANSITION')
  })

  it('SUSPEND de APPROVED (com motivo) ⇒ SUSPENDED; APPROVE nesse estado é recusado; REACTIVATE ⇒ APPROVED', async () => {
    const suspended = await admin.adminDecideProfessional('pro_aprovada', { decision: 'SUSPEND', reason: 'Reclamações.' })
    expect(suspended).toMatchObject({ validationStatus: 'SUSPENDED', statusReason: 'Reclamações.' })
    expect(await code(admin.adminDecideProfessional('pro_aprovada', { decision: 'APPROVE' }))).toBe('INVALID_STATE_TRANSITION')
    const reactivated = await admin.adminDecideProfessional('pro_aprovada', { decision: 'REACTIVATE' })
    expect(reactivated.validationStatus).toBe('APPROVED')
    expect(reactivated.history[0]).toMatchObject({ action: 'REACTIVATED', fromStatus: 'SUSPENDED', toStatus: 'APPROVED' })
  })

  it('REACTIVATE de pro_suspensa (requisitos cumpridos) ⇒ APPROVED; REACTIVATE de um APPROVED ⇒ INVALID_STATE_TRANSITION', async () => {
    expect(await code(admin.adminDecideProfessional('pro_aprovada', { decision: 'REACTIVATE' }))).toBe('INVALID_STATE_TRANSITION')
    const detail = await admin.adminDecideProfessional('pro_suspensa', { decision: 'REACTIVATE' })
    expect(detail.validationStatus).toBe('APPROVED')
  })

  it('id inexistente ⇒ NOT_FOUND', async () => {
    expect(await code(admin.adminDecideProfessional('pro_nao_existe', { decision: 'APPROVE' }))).toBe('NOT_FOUND')
  })
})

// ───── Download de credenciais (auditado) ─────

describe('download de credenciais pelo admin', () => {
  it('CLEAN devolve o ficheiro; inexistente ⇒ NOT_FOUND', async () => {
    const blob = await admin.adminDownloadProfessionalCredential('pro_fila', 'crd_fila_id')
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBeGreaterThan(0)

    expect(await code(admin.adminDownloadProfessionalCredential('pro_fila', 'crd_nao_existe'))).toBe('NOT_FOUND')
    expect(await code(admin.adminDownloadProfessionalCredential('pro_nao_existe', 'crd_fila_id'))).toBe('NOT_FOUND')
  })

  it('PENDING ou INFECTED ⇒ DOCUMENT_NOT_AVAILABLE (contrato)', async () => {
    rec('pro_fila').credentials.find((c) => c.id === 'crd_fila_id')!.scanStatus = 'INFECTED'
    expect(await code(admin.adminDownloadProfessionalCredential('pro_fila', 'crd_fila_id'))).toBe('DOCUMENT_NOT_AVAILABLE')
    rec('pro_fila').credentials.find((c) => c.id === 'crd_fila_id')!.scanStatus = 'PENDING'
    expect(await code(admin.adminDownloadProfessionalCredential('pro_fila', 'crd_fila_id'))).toBe('DOCUMENT_NOT_AVAILABLE')
  })
})

// ───── Catálogo de especialidades (UC-MKT-07) ─────

describe('catálogo de especialidades (admin)', () => {
  it('lista todas (incluindo inativas) com o número de profissionais que a usam', async () => {
    const all = await admin.adminListSpecialties()
    expect(all.find((s) => s.id === 'spc_antiga')).toMatchObject({ active: false, professionalCount: 0 })
    expect(all.find((s) => s.id === 'spc_psico')).toMatchObject({ active: true, professionalCount: 1 })
    expect(all.find((s) => s.id === 'spc_treino')).toMatchObject({ professionalCount: 0 })
  })

  it('cria especialidade com nome válido', async () => {
    const created = await admin.adminCreateSpecialty({ name: '  Acupuntura ', category: 'HEALTH' })
    expect(created).toMatchObject({ name: 'Acupuntura', category: 'HEALTH', active: true, professionalCount: 0 })
  })

  it('nome duplicado sem distinguir maiúsculas ⇒ CONFLICT (BR-MKT-22)', async () => {
    expect(await code(admin.adminCreateSpecialty({ name: 'YOGA', category: 'WELLNESS' }))).toBe('CONFLICT')
    expect(await code(admin.adminCreateSpecialty({ name: 'yoga', category: 'WELLNESS' }))).toBe('CONFLICT')
  })

  it('nome fora de 2–80 caracteres ou categoria inválida ⇒ VALIDATION_ERROR', async () => {
    expect(await code(admin.adminCreateSpecialty({ name: 'A', category: 'HEALTH' }))).toBe('VALIDATION_ERROR')
    expect(await code(admin.adminCreateSpecialty({ name: 'x'.repeat(81), category: 'HEALTH' }))).toBe('VALIDATION_ERROR')
    expect(await code(admin.adminCreateSpecialty({ name: 'Outra', category: 'OUTRA' as 'HEALTH' }))).toBe('VALIDATION_ERROR')
  })

  it('mudar a categoria de uma especialidade em uso ⇒ CONFLICT; de uma não usada ⇒ OK', async () => {
    expect(await code(admin.adminUpdateSpecialty('spc_psico', { category: 'WELLNESS' }))).toBe('CONFLICT')
    expect(await code(admin.adminUpdateSpecialty('spc_treino', { category: 'HEALTH' }))).toBe('OK')
  })

  it('renomear para um nome já existente ⇒ CONFLICT; renomear para um nome novo ⇒ OK', async () => {
    expect(await code(admin.adminUpdateSpecialty('spc_treino', { name: 'Yoga' }))).toBe('CONFLICT')
    expect((await admin.adminUpdateSpecialty('spc_treino', { name: 'Treino funcional' })).name).toBe('Treino funcional')
  })

  it('desativar e reativar; o catálogo do portal só mostra as ativas', async () => {
    signIn('pro_aprovada')
    expect((await portal.listProfessionalSpecialtyCatalog()).map((s) => s.id)).toContain('spc_yoga')

    await admin.adminUpdateSpecialty('spc_yoga', { active: false })
    expect((await portal.listProfessionalSpecialtyCatalog()).map((s) => s.id)).not.toContain('spc_yoga')

    await admin.adminUpdateSpecialty('spc_yoga', { active: true })
    expect((await portal.listProfessionalSpecialtyCatalog()).map((s) => s.id)).toContain('spc_yoga')
  })

  it('patch vazio ⇒ VALIDATION_ERROR; especialidade inexistente ⇒ NOT_FOUND', async () => {
    expect(await code(admin.adminUpdateSpecialty('spc_yoga', {}))).toBe('VALIDATION_ERROR')
    expect(await code(admin.adminUpdateSpecialty('spc_nao_existe', { active: false }))).toBe('NOT_FOUND')
  })

  it('a desativação não remove as ofertas existentes do profissional', async () => {
    await admin.adminUpdateSpecialty('spc_yoga', { active: false })
    expect(rec('pro_aprovada').offers.map((o) => o.id)).toContain('ofr_ap_1')
  })
})
