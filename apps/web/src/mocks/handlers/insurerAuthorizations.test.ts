import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { db, resetDb } from '../db'
import * as clinic from './clinicAuthorizations'
import * as ins from './insurerAuthorizations'

const CLINIC = 'cac_horizonte_admin'
const ADMIN = 'iac_aurora_admin'
const AGENT = 'iac_aurora_agent'
const AN1 = 'iac_aurora_analyst'
const AN2 = 'iac_aurora_analyst2'
const SUP1 = 'iac_aurora_supervisor'
const SUP2 = 'iac_aurora_supervisor2'
const NOW = new Date('2026-11-20T10:00:00.000Z')
const code = (p: Promise<unknown>) => p.then(() => 'OK', (e: AppError) => e.code)

async function newRequest(over: { card?: string; serviceCode?: string; amount?: number } = {}) {
  return clinic.createAuthorization(
    CLINIC,
    { insurerId: 'ins_aurora', cardNumber: over.card ?? 'AUR-000001', serviceCode: over.serviceCode ?? 'IMG-RX', requestedAmount: over.amount ?? 1000, expectedOn: '2026-12-30', justification: 'Pedido do serviço de saúde' },
    NOW,
  )
}

beforeEach(() => resetDb())

describe('decisão pela seguradora: acesso e separação de funções (§8.2d)', () => {
  it('Admin lê, Agente não acede, só o analista decide pedidos normais', async () => {
    const r = await newRequest()
    expect(r.status).toBe('IN_REVIEW')
    expect((await ins.listAuthorizations(ADMIN, {}, NOW)).items).toHaveLength(1)
    expect(await code(ins.listAuthorizations(AGENT))).toBe('FORBIDDEN')
    expect(await code(ins.approve(ADMIN, r.id, {}, NOW))).toBe('FORBIDDEN')
    expect(await code(ins.approve(SUP1, r.id, {}, NOW))).toBe('FORBIDDEN')
    expect((await ins.approve(AN1, r.id, {}, NOW)).status).toBe('APPROVED')
  })

  it('módulo desativado ⇒ NOT_FOUND', async () => {
    db.insurerOps.modules.ins_aurora!.enabled = false
    expect(await code(ins.listAuthorizations(AN1))).toBe('NOT_FOUND')
  })

  it('dois analistas: o 2.º não decide o pedido atribuído ao 1.º', async () => {
    const r = await newRequest()
    await ins.assign(AN1, r.id, undefined, NOW)
    expect(await code(ins.approve(AN2, r.id, {}, NOW))).toBe('CONFLICT')
    expect(await code(ins.assign(AN2, r.id, undefined, NOW))).toBe('CONFLICT')
  })

  it('recusa e recurso: o analista não decide o recurso; o supervisor da origem não; o outro sim', async () => {
    const r = await newRequest()
    await ins.reject(AN1, r.id, 'Fora de cobertura', NOW)
    const appeal = await clinic.appealAuthorization(CLINIC, r.id, { justification: 'Novo fundamento' }, NOW)
    expect(await code(ins.approve(AN1, appeal.id, {}, NOW))).toBe('FORBIDDEN')
    const s1 = await ins.reject(SUP1, appeal.id, 'Mantém-se', NOW)
    expect(s1.decidedBy).toBe('SUPERVISOR')
    const second = await clinic.appealAuthorization(CLINIC, appeal.id, { justification: 'Outro recurso' }, NOW)
    expect(await code(ins.approve(SUP1, second.id, {}, NOW))).toBe('FORBIDDEN')
    expect((await ins.approve(SUP2, second.id, {}, NOW)).status).toBe('APPROVED')
  })
})

describe('aprovar, pedir informação, reverter e reabrir', () => {
  it('em parte exige nota; valor acima do pedido ⇒ erro; a clínica vê o motivo mas não o decisor', async () => {
    const r = await newRequest()
    expect(await code(ins.approve(AN1, r.id, { authorizedAmount: 500 }, NOW))).toBe('VALIDATION_ERROR')
    expect(await code(ins.approve(AN1, r.id, { authorizedAmount: 5000 }, NOW))).toBe('VALIDATION_ERROR')
    const done = await ins.approve(AN1, r.id, { authorizedAmount: 500, note: 'Só parte' }, NOW)
    expect(done).toMatchObject({ status: 'APPROVED', partial: true, decidedBy: 'ANALYST' })
    const seen = await clinic.getAuthorization(CLINIC, r.id, NOW)
    expect(seen).toMatchObject({ status: 'APPROVED', decisionNote: 'Só parte' })
    expect(JSON.stringify(seen)).not.toMatch(/decidedBy|autoApproval|internalNote|assignedTo/)
  })

  it('reverter: o analista só as suas; o supervisor qualquer; ANALYST_CANCELLED e o código deixa de aparecer', async () => {
    const r = await newRequest()
    await ins.approve(AN1, r.id, {}, NOW)
    expect(await code(ins.cancel(SUP1, r.id, '', NOW))).toBe('VALIDATION_ERROR')
    const reverted = await ins.cancel(AN2, r.id, 'Erro de registo', NOW)
    expect(reverted).toMatchObject({ status: 'CANCELLED', closedReason: 'ANALYST_CANCELLED', code: null })
  })

  it('reabrir só o supervisor, dentro do prazo; o motivo é interno', async () => {
    const r = await newRequest()
    await ins.reject(AN1, r.id, 'Não', NOW)
    expect(await code(ins.reopen(AN1, r.id, 'x', NOW))).toBe('FORBIDDEN')
    const reopened = await ins.reopen(SUP1, r.id, 'Documento novo', NOW)
    expect(reopened.status).toBe('IN_REVIEW')
    expect(reopened.timeline.at(-1)?.internalNote).toBe('Documento novo')
    expect(JSON.stringify(await clinic.getAuthorization(CLINIC, r.id, NOW))).not.toContain('Documento novo')
    expect(await code(ins.approve(AN1, r.id, {}, NOW))).toBe('FORBIDDEN') // quem recusou não volta a decidir
  })

  it('o prazo só marca: nunca decide', async () => {
    const r = await newRequest()
    const later = new Date(NOW.getTime() + 30 * 86_400_000)
    expect(ins.flagSlaBreaches(later)).toBe(1)
    expect(ins.flagSlaBreaches(later)).toBe(0)
    const view = await ins.getAuthorization(SUP1, r.id, later)
    expect(view).toMatchObject({ status: 'IN_REVIEW', slaStatus: 'OVERDUE' })
    expect(view.escalatedAt).not.toBeNull()
  })
})

describe('regras de aprovação automática', () => {
  it('CRUD só do supervisor; uma ativa por alvo; auto-aprova na criação; carência nunca', async () => {
    expect(await code(ins.createRule(AN1, { name: 'x', serviceId: 'svc_rx', maxAmount: 10 }))).toBe('FORBIDDEN')
    const rule = await ins.createRule(SUP1, { name: 'Raio-X', serviceId: 'svc_rx', maxAmount: 2000 })
    expect(await code(ins.createRule(SUP1, { name: 'Dup', serviceId: 'svc_rx', maxAmount: 1 }))).toBe('CONFLICT')
    expect(await code(ins.createRule(SUP1, { name: 'x', maxAmount: 1 }))).toBe('VALIDATION_ERROR')
    expect((await ins.listRules(AN1))[0]?.targetName).toBe('Radiografia')
    const auto = await newRequest({ amount: 1500 })
    expect(auto.status).toBe('APPROVED')
    const detail = await ins.getAuthorization(SUP1, auto.id, NOW)
    expect(detail).toMatchObject({ decidedBy: 'SYSTEM', autoApproval: { ok: true } })
    expect(await code(ins.cancel(AN1, auto.id, 'x', NOW))).toBe('FORBIDDEN')
    expect((await ins.cancel(SUP1, auto.id, 'Revisão', NOW)).status).toBe('CANCELLED')
    // valor acima da regra ⇒ análise humana com rasto
    const above = await newRequest({ card: 'AUR-000002', amount: 3000 })
    expect(above.status).toBe('IN_REVIEW')
    await ins.updateRule(SUP1, rule.id, { active: false })
    await ins.deleteRule(SUP1, rule.id)
    await ins.deleteRule(SUP1, rule.id) // idempotente
    expect(await ins.listRules(SUP1)).toEqual([])
  })
})
